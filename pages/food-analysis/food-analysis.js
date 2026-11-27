const { analyzeMealPhoto, saveMealRecord, previewMealSuitability, fetchGlucoseRecords, fetchFoods } = require('../../services/api')
const { buildDishGroups } = require('../../utils/meal-dish')
const { getTodayKey, getRecords, saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')
const { uploadMealImage } = require('../../utils/media')
const { getToken } = require('../../utils/request')
const { getNodeRecordWindow } = require('../../utils/record-window')
const { GLUCOSE_NODES } = require('../../utils/constants')

const BEFORE_MEAL = { breakfast: 'before_breakfast', lunch: 'before_lunch', dinner: 'before_dinner' }
// 餐后上下文取真正餐后血糖节点（after_*）；breakfast/lunch/dinner 是餐点节点，不接受血糖记录
const AFTER_MEAL = { breakfast: 'after_breakfast', lunch: 'after_lunch', dinner: 'after_dinner' }

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function rounded(value) { return Math.round(value * 10) / 10 }
function formatClock(value) {
  if (!value) return ''
  const match = /(\d{1,2}):(\d{2})/.exec(String(value).replace('T', ' '))
  return match ? match[1].padStart(2, '0') + ':' + match[2] : ''
}
function pickGlucose(page) {
  const record = page && page.records && page.records.length ? page.records[0] : null
  const value = record ? numberOrNull(record.value) : null
  if (value === null || !(value > 0 && value < 40)) return null
  return { value, time: formatClock(record.recordedAt || record.time) }
}
// 三档展示文案与建议兜底：后端 adviceText 缺失时使用，不含绝对化结论
// 单项建议去掉与右侧档位标签重复的开头，避免同一结论连续出现两次
function stripTierPrefix(text, label) {
  if (!text || !label || text.indexOf(label) !== 0) return text || ''
  return text.slice(label.length).replace(/^[，,、；;：:\s]+/, '')
}
const TIER_LABELS = { LOW: '建议食用', MODERATE: '适量食用', HIGH: '不建议食用', UNKNOWN: '信息不足' }
const ADVICE_FALLBACK = {
  LOW: '建议食用，注意保持均衡搭配',
  MODERATE: '适量食用，注意进食顺序与搭配',
  HIGH: '不建议食用，可换用升糖负担更低的食物',
  UNKNOWN: '信息不足，建议补充重量或改用食品库食物'
}
const EMPTY_TIER_COUNTS = { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 }

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    // 状态机：idle → uploading → recognizing → ready / recognize_failed / empty
    // （阶段 3d 在此基础上增加 low_confidence）
    phase: 'idle',
    errorMessage: '',
    busy: false,
    mediaId: '',
    analysisToken: '',
    needsConfirmation: false,
    items: [],
    warnings: [],
    matchedCount: 0,
    estimatedCount: 0,
    model: '',
    supplement: '',
    currentGlucose: '',
    beforeMealRecorded: false,
    glucoseNodes: [],
    glucoseContext: null,
    glucoseLoading: false,
    preview: null,
    previewLoading: false,
    previewError: '',
    tierCounts: { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 },
    analysisSub: '',
    focusLines: [],
    basisItems: [],
    adviceItems: [],
    adviceTitle: '逐项建议',
    adviceToggleLabel: '',
    adviceEmptyText: '添加食物后给出逐项建议',
    adviceOpen: false,
    ruleBasisOpen: false,
    rateFilter: '',
    foodListExpanded: false,
    foodsText: '',
    foodNamesText: '',
    mealSummaryText: '等待识别',
    carbsG: null,
    caloriesKcal: null,
    analysisReady: false,
    nutritionUnknownCount: 0,
    pendingConfirmCount: 0,
    confirmableCount: 0,
    allConfirmed: false,
    someConfirmed: false,
    saveError: '',
    speechVisible: false,
    addSheetVisible: false,
    addReplacing: false,
    addMode: 'search',
    addKeyword: '',
    addResults: [],
    addLoading: false,
    deleteMode: false,
    gramEditingIndex: -1,
    portionEditingIndex: -1,
    portionInput: '',
    addForm: { name: '', weight: '', carbs: '', calories: '' }
  },

  onLoad(options) {
    this._alive = true
    this._recordDate = getTodayKey()
    const nodeId = options.nodeId || 'breakfast'
    const records = getRecords(this._recordDate)
    const cached = records[BEFORE_MEAL[nodeId]]
    const glucose = cached && cached.type === 'glucose' ? numberOrNull(cached.value) : null
    const currentGlucose = glucose > 0 && glucose < 40 ? String(glucose) : ''
    const imagePath = readShotImage() || ''
    this.setData({
      nodeId,
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath,
      currentGlucose,
      beforeMealRecorded: !!(records[BEFORE_MEAL[nodeId]] || records[nodeId])
    })
    // 血糖上下文以服务端为准（只读）；本地缓存仅用于首屏占位
    this.loadGlucoseContext()
    // 没有照片时不进入识别流程，停留在 idle 提示重拍
    if (!imagePath) return
    return this.recognize()
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.refreshGlucoseFromCache()
  },

  refreshGlucoseFromCache() {
    if (!this._alive || !this.data.nodeId) return
    const records = getRecords(this._recordDate)
    const recorded = !!(records[BEFORE_MEAL[this.data.nodeId]] || records[this.data.nodeId])
    const cached = records[BEFORE_MEAL[this.data.nodeId]]
    const glucose = cached && cached.type === 'glucose' ? numberOrNull(cached.value) : null
    const currentGlucose = glucose > 0 && glucose < 40 ? String(glucose) : ''
    if (currentGlucose && currentGlucose !== this.data.currentGlucose) {
      // 从血糖页返回：先按本地缓存即时刷新，稍后由服务端校准
      this.setData({ currentGlucose })
    }
    if (recorded !== this.data.beforeMealRecorded) this.setData({ beforeMealRecorded: recorded })
    this.loadGlucoseContext()
  },
  async loadGlucoseContext() {
    const beforeNode = BEFORE_MEAL[this.data.nodeId]
    const afterNode = AFTER_MEAL[this.data.nodeId]
    if (!beforeNode || !afterNode || !this._recordDate) return
    const version = (this._glucoseVersion || 0) + 1
    this._glucoseVersion = version
    this.setData({ glucoseLoading: true })
    try {
      const [beforePage, afterPage] = await Promise.all([
        fetchGlucoseRecords({ startDate: this._recordDate, endDate: this._recordDate, nodeCode: beforeNode, pageSize: 1 }),
        fetchGlucoseRecords({ startDate: this._recordDate, endDate: this._recordDate, nodeCode: afterNode, pageSize: 1 })
      ])
      if (!this._alive || version !== this._glucoseVersion) return
      const before = pickGlucose(beforePage)
      const after = pickGlucose(afterPage)
      const beforeValue = before ? before.value : null
      const afterValue = after ? after.value : null
      const delta = beforeValue !== null && afterValue !== null ? rounded(afterValue - beforeValue) : null
      const afterName = (GLUCOSE_NODES.find((node) => node.id === afterNode) || {}).name || '餐后'
      this.setData({
        glucoseLoading: false,
        glucoseContext: beforeValue === null && afterValue === null ? null : { before: beforeValue, after: afterValue, delta },
        glucoseNodes: [
          { key: 'before', label: '餐前', nodeCode: beforeNode, nodeName: this.data.nodeName,
            value: beforeValue, time: before ? before.time : '' },
          { key: 'after', label: '餐后', nodeCode: afterNode, nodeName: afterName,
            value: afterValue, time: after ? after.time : '' }
        ],
        currentGlucose: beforeValue === null ? '' : String(beforeValue)
      })
    } catch (error) {
      // 只读上下文失败不阻塞主流程，保留本地缓存值
      if (this._alive && version === this._glucoseVersion) this.setData({ glucoseLoading: false })
    }
  },
  onUnload() {
    this._alive = false
    this._analysisVersion = (this._analysisVersion || 0) + 1
    this._previewVersion = (this._previewVersion || 0) + 1
    this._glucoseVersion = (this._glucoseVersion || 0) + 1
    clearTimeout(this._previewTimer)
    this.clearAddSearch()
  },

  ensureOpen() {
    const window = getNodeRecordWindow(this.data.nodeId, new Date())
    if (window.locked || this._recordDate !== getTodayKey()) {
      wx.showModal({
        title: '该时段已截止',
        content: window.locked ? window.lockReason : '拍照日期已变化，请返回记录页重新拍照。',
        showCancel: false,
        complete: () => wx.switchTab({ url: '/pages/ai/ai' })
      })
      return false
    }
    return true
  },

  ensureLogin() {
    if (getToken()) return true
    wx.showModal({
      title: '请先登录',
      content: '登录后才能识别和保存正餐照片。',
      showCancel: false,
      success: () => wx.reLaunch({ url: '/pages/login/login' })
    })
    return false
  },

  async ensureUploaded() {
    if (!this._mediaPromise) {
      const path = this.data.imagePath
      if (!path) throw new Error('没有可识别的餐食照片，请重新拍照')
      this._mediaPromise = uploadMealImage(path).catch((error) => {
        this._mediaPromise = null
        throw error
      })
    }
    const media = await this._mediaPromise
    return media.id
  },

  async recognize() {
    if (this.data.phase === 'uploading' || this.data.phase === 'recognizing' || this.data.busy) return
    if (!this.ensureLogin() || !this.ensureOpen()) return
    const version = (this._analysisVersion || 0) + 1
    this._analysisVersion = version
    this.setData({
      phase: 'uploading',
      errorMessage: '',
      analysisReady: false,
      carbsG: null,
      caloriesKcal: null,
      foodsText: ''
    })
    try {
      const mediaId = await this.ensureUploaded()
      if (!this._alive || version !== this._analysisVersion) return
      this.setData({ phase: 'recognizing' })
      const input = { mediaId, nodeCode: this.data.nodeId, foodText: this.data.supplement.trim() || undefined }
      const fingerprint = JSON.stringify(input)
      if (this._analysisInput !== fingerprint) {
        this._analysisInput = fingerprint
        this._analysisKey = 'meal-' + Date.now() + '-' + Math.random().toString(36).slice(2)
      }
      const result = await analyzeMealPhoto(input, this._analysisKey)
      if (!this._alive || version !== this._analysisVersion) return
      const items = (result && Array.isArray(result.items) ? result.items : []).map((item, index) => ({
        ...item,
        key: 'food-' + index,
        weightInput: item.weightG == null ? '' : String(item.weightG),
        // 份量快捷以识别克重为基准，后续改重量/换食物不改变基准（换食物时单独重置）
        baseWeight: item.weightG == null ? '' : String(item.weightG),
        userCorrected: false,
        // 低置信项默认未确认，由用户逐项勾选后放行保存
        confirmed: !item.needsConfirmation,
        dishName: item.dishName || '',
        role: item.role || '',
        cookMethod: item.cookMethod || '',
        roleText: item.role === 'SEASONING' ? '配料' : (item.role === 'MAIN' ? '主料' : ''),
        sourceText: item.nutritionSource === 'AI_ESTIMATE' ? '模型估算 · 待审核'
          : item.nutritionSource === 'LIBRARY' ? '食品库数据' : '待确认',
        per100Text: item.carbsPer100g == null || item.caloriesPer100g == null ? '营养未知，不计入总量'
          : '每100g：碳水 ' + item.carbsPer100g + 'g · 热量 ' + item.caloriesPer100g + 'kcal'
            + (item.giValue == null ? '' : ' · GI ' + item.giValue)
      }))
      const base = {
        mediaId,
        analysisToken: (result && result.analysisToken) || '',
        needsConfirmation: !!(result && result.needsConfirmation),
        warnings: (result && result.warnings) || [],
        // 头部统计统一从当前 items 派生，避免后端口径与文案语义不一致
        matchedCount: 0,
        estimatedCount: 0,
        model: (result && result.model) || '',
        foodListExpanded: false
      }
      if (!items.length) {
        // 空结果独立成态：不伪造食物，也不允许保存
        this.setData({ ...base, items: [], phase: 'empty', analysisReady: false })
        return
      }
      this.setData({ ...base, items, phase: 'ready' })
      this.recalculate()
    } catch (error) {
      if (!this._alive || version !== this._analysisVersion) return
      this.setData({
        phase: 'recognize_failed',
        errorMessage: (error && error.message) || '识别失败，请重试',
        analysisReady: false
      })
      if (error && error.code === 40100) this.ensureLogin()
    }
  },

  recalculate() {
    // 两级判定：weightValid 决定能否保存；nutritionKnown 决定是否计入总量
    let weightReady = this.data.items.length > 0
    let carbs = 0
    let calories = 0
    let unknownCount = 0
    const nutritionCards = []
    const items = this.data.items.map((item) => {
      const weight = numberOrNull(item.weightInput)
      const weightValid = weight > 0 && weight <= 5000
      const base = numberOrNull(item.baseWeight)
      const perCarbs = numberOrNull(item.carbsPer100g)
      const perCalories = numberOrNull(item.caloriesPer100g)
      const nutritionKnown = perCarbs !== null && perCarbs >= 0 && perCalories !== null && perCalories >= 0
      if (!weightValid) weightReady = false
      if (!nutritionKnown) unknownCount += 1
      const itemCarbs = nutritionKnown && weightValid ? rounded(weight * perCarbs / 100) : null
      const itemCalories = nutritionKnown && weightValid ? rounded(weight * perCalories / 100) : null
      if (itemCarbs !== null) { carbs += itemCarbs; calories += itemCalories }
      // 营养卡：每 100g 的碳水/热量/升糖负荷（GL = GI × 每100g碳水 / 100），与克重无关
      const perGi = numberOrNull(item.giValue)
      const perGl = perCarbs !== null && perGi !== null ? rounded(perGi * perCarbs / 100) : null
      nutritionCards.push({
        key: item.key || ('nutri-' + nutritionCards.length),
        name: item.foodName,
        dishName: item.dishName || '',
        weightText: weightValid ? weight + 'g' : '重量待确认',
        carbsText: perCarbs === null ? '—' : perCarbs + 'g',
        caloriesText: perCalories === null ? '—' : perCalories + 'kcal',
        glText: perGl === null ? '—' : String(perGl),
        unknown: perCarbs === null || perCalories === null
      })
      // 份数以识别克重为基准，仅用于显示与步进；提交仍只使用 weightG
      const portion = weightValid && base > 0 ? Math.round(weight / base * 10) / 10 : null
      return { ...item, weightG: weightValid ? weight : null, weightValid, nutritionKnown,
        carbsG: itemCarbs, caloriesKcal: itemCalories,
        sourceText: item.userCorrected ? '已人工修正' : item.sourceText,
        portionValue: portion === null ? '—' : String(portion),
        portionDisabled: !(base > 0) }
    })
    const totalValid = carbs <= 1000 && calories <= 20000
    const ready = weightReady && totalValid
    const confirmable = items.filter((item) => item.needsConfirmation)
    const confirmedCount = confirmable.filter((item) => item.confirmed).length
    const pendingConfirm = confirmable.length - confirmedCount
    const estimatedCount = items.filter((item) => item.nutritionSource === 'AI_ESTIMATE').length
    const matchedCount = items.filter((item) => item.nutritionSource === 'LIBRARY'
      && item.libraryStatus === 'AVAILABLE').length
    this.setData({
      items, analysisReady: ready, nutritionUnknownCount: unknownCount,
      pendingConfirmCount: pendingConfirm,
      confirmableCount: confirmable.length,
      estimatedCount,
      matchedCount,
      allConfirmed: confirmable.length > 0 && pendingConfirm === 0,
      someConfirmed: confirmedCount > 0 && pendingConfirm > 0,
      carbsG: items.length ? rounded(carbs) : null,
      caloriesKcal: items.length ? rounded(calories) : null,
      dishGroups: buildDishGroups(items),
      nutritionCards,
      nutritionTotals: {
        carbsText: items.length && carbs > 0 ? rounded(carbs) + 'g' : '—',
        caloriesText: items.length && calories > 0 ? rounded(calories) + 'kcal' : '—',
        countText: items.length + ' 样',
        missingText: unknownCount > 0 ? unknownCount + ' 样缺营养数据，未计入合计' : ''
      },
      foodsText: items.map((item) => item.foodName + (item.weightG > 0 ? ' ' + item.weightG + 'g' : '（重量待确认）')).join('、').slice(0, 512),
      foodNamesText: items.map((item) => item.foodName).join(' · ').slice(0, 200),
      mealSummaryText: items.length ? '识别 ' + items.length + ' 种食物'
        : (this.data.phase === 'empty' ? '未识别到食物' : '等待识别')
    })
    // 可保存时才请求服务端适食分析；不可保存则清空，避免展示过期档位
    if (ready) this.schedulePreview()
    else {
      this._previewVersion = (this._previewVersion || 0) + 1
      this.setData({ preview: null, previewError: '', previewLoading: false,
        tierCounts: { ...EMPTY_TIER_COUNTS }, analysisSub: '', focusLines: [], basisItems: [], adviceItems: [],
        adviceTitle: '逐项建议', adviceToggleLabel: '' })
    }
  },

  schedulePreview() {
    clearTimeout(this._previewTimer)
    this._previewTimer = setTimeout(() => this.loadPreview(), 400)
  },
  async loadPreview() {
    if (!this._alive || !this.data.analysisReady || this.data.phase !== 'ready' || !this.data.items.length) return
    const version = (this._previewVersion || 0) + 1
    this._previewVersion = version
    this.setData({ previewLoading: true, previewError: '' })
    try {
      const result = await previewMealSuitability({
        nodeCode: this.data.nodeId,
        items: this.data.items.map((item) => ({
          foodId: item.foodId || undefined,
          libraryFoodId: item.libraryFoodId || undefined,
          foodName: item.foodName,
          categoryCode: item.categoryCode == null ? undefined : item.categoryCode,
          weightG: item.weightG,
          carbsG: item.carbsG,
          caloriesKcal: item.caloriesKcal,
          giValue: item.giValue == null ? undefined : item.giValue,
          nutritionSource: item.nutritionSource || undefined,
          confidence: item.confidence == null ? undefined : item.confidence,
          userCorrected: item.userCorrected === true,
          libraryStatus: item.libraryStatus || undefined,
          dishName: item.dishName || undefined,
          role: item.role || undefined,
          cookMethod: item.cookMethod || undefined
        }))
      })
      if (!this._alive || version !== this._previewVersion) return
      this.setData({ preview: result, previewLoading: false,
        ...this.buildAnalysis(result, this.data.rateFilter, this.data.adviceOpen) })
    } catch (error) {
      if (!this._alive || version !== this._previewVersion) return
      this.setData({ preview: null, previewLoading: false,
        previewError: (error && error.message) || '分析暂不可用，可稍后重试',
        tierCounts: { ...EMPTY_TIER_COUNTS }, analysisSub: '', focusLines: [], basisItems: [], adviceItems: [],
        adviceTitle: '逐项建议', adviceToggleLabel: '' })
    }
  },

  // 分析卡展示数据：档位计数、结论说明、逐项建议（后端 adviceText 优先，缺失按档位兜底）
  buildAnalysis(preview, filter, open) {
    const list = preview && Array.isArray(preview.items) ? preview.items : []
    const tierCounts = { ...EMPTY_TIER_COUNTS }
    list.forEach((item) => { if (tierCounts[item.tier] != null) tierCounts[item.tier] += 1 })
    const namesOf = (tier) => list.filter((item) => item.tier === tier)
      .map((item) => item.foodName).slice(0, 3).join('、')
    let analysisSub = ''
    if (!list.length) analysisSub = '添加食物后自动给出分析'
    else if (preview.tier === 'HIGH') analysisSub = (namesOf('HIGH') ? namesOf('HIGH') + '：' : '') + '建议换用升糖负担更低的食物'
    else if (preview.tier === 'MODERATE') analysisSub = (namesOf('MODERATE') ? namesOf('MODERATE') + '：' : '') + '建议适量食用，可先吃蔬菜和蛋白质'
    else if (preview.tier === 'LOW') analysisSub = '所选食物都建议食用'
    else analysisSub = '补充食物重量或改用食品库食物后可评估'
    // 重点关注：单项 HIGH 的元凶标记（后端 focusItems，文案已定稿），只标注不改整餐档位
    const focusLines = (preview && Array.isArray(preview.focusItems) ? preview.focusItems : [])
      .filter((focus) => focus && focus.text)
      .map((focus) => focus.text)
    const active = filter || ''
    const shown = active ? list.filter((item) => item.tier === active) : list
    // 逐项建议按“需要注意”优先排序：HIGH → MODERATE → LOW → UNKNOWN，同档保持识别顺序
    const rank = { HIGH: 0, MODERATE: 1, LOW: 2, UNKNOWN: 3 }
    const adviceItems = shown
      .map((item) => {
        const tier = item.tier || 'UNKNOWN'
        const tierLabel = item.tierLabel || TIER_LABELS[tier] || TIER_LABELS.UNKNOWN
        const adviceText = item.adviceText || ADVICE_FALLBACK[tier] || ADVICE_FALLBACK.UNKNOWN
        return { foodName: item.foodName, tier, tierLabel, adviceText,
          adviceLine: stripTierPrefix(adviceText, tierLabel) }
      })
      .sort((a, b) => (rank[a.tier] == null ? 3 : rank[a.tier]) - (rank[b.tier] == null ? 3 : rank[b.tier]))
    // 分析依据：每项判定依据（档位、规则、GI 来源、缺失字段、重点关注），数据全部来自后端
    const basisItems = list.map((item) => {
      const tier = item.tier || 'UNKNOWN'
      const missing = Array.isArray(item.missingFields) && item.missingFields.length
        ? '缺少' + item.missingFields.join('、') : ''
      return {
        foodName: item.foodName,
        tier,
        tierLabel: item.tierLabel || TIER_LABELS[tier] || TIER_LABELS.UNKNOWN,
        ruleCode: item.ruleCode || '',
        giSourceText: item.giSource === 'CLIENT' ? 'GI 为输入值' : (item.giSource === 'LIBRARY' ? 'GI 取自营养库' : ''),
        giLowNote: item.giReliability === 'LOW' ? '与库值差异较大，结果仅供参考' : '',
        focused: item.focused === true,
        focusLabel: '升糖负担高',
        missingText: missing
      }
    })
    return {
      tierCounts,
      analysisSub,
      focusLines,
      basisItems,
      adviceItems,
      adviceTitle: '逐项建议' + (active ? ' · ' + (TIER_LABELS[active] || '') : ''),
      adviceToggleLabel: open ? '收起' : '展开 ' + adviceItems.length + ' 项',
      adviceEmptyText: active ? '没有该档位的食物' : '添加食物后给出逐项建议'
    }
  },

  onFilterTier(e) {
    const tier = e.currentTarget.dataset.tier
    if (!tier) return
    const rateFilter = this.data.rateFilter === tier ? '' : tier
    const adviceOpen = rateFilter ? true : this.data.adviceOpen
    this.setData({ rateFilter, adviceOpen,
      ...this.buildAnalysis(this.data.preview, rateFilter, adviceOpen) })
  },
  onClearFilter() {
    this.setData({ rateFilter: '',
      ...this.buildAnalysis(this.data.preview, '', this.data.adviceOpen) })
  },
  onToggleAdvice() {
    const adviceOpen = !this.data.adviceOpen
    this.setData({ adviceOpen,
      adviceToggleLabel: adviceOpen ? '收起' : '展开 ' + this.data.adviceItems.length + ' 项' })
  },
  onToggleRuleBasis() {
    this.setData({ ruleBasisOpen: !this.data.ruleBasisOpen })
  },

  onWeightInput(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    if (!this.data.items[index]) return
    const items = this.data.items.map((item, position) => position === index ? { ...item, weightInput: e.detail.value } : item)
    this.setData({ items })
    this.recalculate()
  },
  onWeightBlur(e) {
    if (Number(e.currentTarget.dataset.index) === this.data.gramEditingIndex) {
      this.setData({ gramEditingIndex: -1 })
    }
  },
  onOpenWeightEdit(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    if (!this.data.items[index]) return
    // 克重输入框只替换克重本身，份量数值保持原位，避免焦点看起来跳到份量
    this.setData({ gramEditingIndex: index, portionEditingIndex: -1 })
  },
  onPortionTap(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return
    const now = Date.now()
    if (this._portionTapIndex === index && now - this._portionTapTime < 300) {
      this._portionTapIndex = -1
      const base = numberOrNull(item.baseWeight)
      if (!(base > 0)) {
        wx.showToast({ title: '请先填写克重', icon: 'none' })
        return
      }
      this.setData({
        portionEditingIndex: index,
        portionInput: item.portionValue === '—' ? '' : String(item.portionValue),
        gramEditingIndex: -1
      })
      return
    }
    this._portionTapIndex = index
    this._portionTapTime = now
  },
  onPortionInput(e) {
    this.setData({ portionInput: e.detail.value })
  },
  onPortionBlur(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index !== this.data.portionEditingIndex) return
    const item = this.data.items[index]
    const base = item ? numberOrNull(item.baseWeight) : null
    if (!item || !(base > 0)) {
      this.setData({ portionEditingIndex: -1, portionInput: '' })
      return
    }
    const raw = numberOrNull(this.data.portionInput)
    // 份量按 0.5 吸附，保持整份/半份精度
    let portion = raw === null ? 0.5 : Math.round(raw * 2) / 2
    if (portion < 0.5) portion = 0.5
    if (portion > 20) portion = 20
    let weight = Math.round(base * portion)
    if (weight < 1) weight = 1
    if (weight > 5000) weight = 5000
    const items = this.data.items.map((current, position) => position === index
      ? { ...current, weightInput: String(weight) } : current)
    this.setData({ items, portionEditingIndex: -1, portionInput: '' })
    this.recalculate()
  },
  onToggleConfirm(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return
    const items = this.data.items.map((current, position) => position === index
      ? { ...current, confirmed: !current.confirmed } : current)
    this.setData({ items, saveError: '' })
    this.recalculate()
  },
  onToggleAllConfirm() {
    if (this.data.busy) return
    // 半选时点一下全选，全部确认后再点则全不选
    const next = !this.data.allConfirmed
    const items = this.data.items.map((item) => item.needsConfirmation
      ? { ...item, confirmed: next } : item)
    this.setData({ items, saveError: '' })
    this.recalculate()
  },
  onSupplementInput(e) {
    // 备注随保存提交，不触发重新识别，也不作废已有分析
    this.setData({ supplement: e.detail.value })
  },
  onOpenSpeechInput() {
    if (this.data.busy) return
    this.setData({ speechVisible: true })
  },
  onCloseSpeechInput() {
    this.setData({ speechVisible: false })
  },
  onSpeechConfirm(e) {
    const text = String((e.detail && e.detail.text) || '').trim().slice(0, 200)
    this.setData({ supplement: text, speechVisible: false })
  },
  onRenameItem(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return
    wx.showModal({
      title: '修改食物名称',
      editable: true,
      placeholderText: '请输入食物名称',
      content: item.foodName,
      success: (res) => {
        if (!res.confirm) return
        const name = String(res.content || '').trim().slice(0, 64)
        if (!name) {
          wx.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        // 改名后不再指向营养库原条目，由服务端按新名重新匹配
        const items = this.data.items.map((current, position) => position === index
          ? { ...current, foodName: name, foodId: null, libraryFoodId: null, userCorrected: true }
          : current)
        this.setData({ items })
        this.recalculate()
      }
    })
  },
  onRemoveItem(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return
    wx.showModal({
      title: '删除这项食物？',
      content: item.foodName,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (res) => {
        if (res.confirm) this.removeItemAt(index)
      }
    })
  },
  removeItemAt(index) {
    const items = this.data.items.filter((_, position) => position !== index)
    if (!items.length) {
      this.setData({ items: [], phase: 'empty', deleteMode: false })
      this.recalculate()
      return
    }
    this.setData({ items })
    this.recalculate()
  },
  onPortionStep(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const delta = Number(e.currentTarget.dataset.delta)
    const target = this.data.items[index]
    if (!target || !Number.isFinite(delta)) return
    const base = numberOrNull(target.baseWeight)
    if (!(base > 0)) {
      wx.showToast({ title: '请先填写克重', icon: 'none' })
      return
    }
    const weight = numberOrNull(target.weightInput)
    const current = weight > 0 ? Math.round(weight / base * 10) / 10 : 1
    const next = Math.max(0.5, Math.round((current + delta) * 10) / 10)
    let nextWeight = Math.round(base * next)
    if (nextWeight > 5000) nextWeight = 5000
    if (nextWeight < 1) nextWeight = 1
    const items = this.data.items.map((item, position) => position === index
      ? { ...item, weightInput: String(nextWeight) } : item)
    this.setData({ items })
    this.recalculate()
  },
  onReplaceItem(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    if (!(index >= 0 && index < this.data.items.length)) return
    this._editingIndex = index
    this.openAddSheet('search', true)
  },
  onOpenAddSheet() {
    if (this.data.busy) return
    if (this.data.items.length >= 50) {
      wx.showToast({ title: '最多添加 50 项食物', icon: 'none' })
      return
    }
    this._editingIndex = -1
    this.openAddSheet('search', false)
  },
  openAddSheet(mode, replacing) {
    this.setData({
      addSheetVisible: true,
      addReplacing: !!replacing,
      addMode: mode || 'search',
      addKeyword: '',
      addResults: [],
      addLoading: false,
      deleteMode: false,
      addForm: { name: '', weight: '', carbs: '', calories: '' }
    })
  },
  onCloseAddSheet() {
    this.clearAddSearch()
    this._editingIndex = -1
    this.setData({ addSheetVisible: false, addReplacing: false, addMode: 'search', addLoading: false })
  },
  clearAddSearch() {
    if (this._addTimer) { clearTimeout(this._addTimer); this._addTimer = null }
    this._addSearchSeq = (this._addSearchSeq || 0) + 1
  },
  onAddKeywordInput(e) {
    const keyword = String(e.detail.value || '').trim()
    this.setData({ addKeyword: keyword })
    this.clearAddSearch()
    if (!keyword) { this.setData({ addResults: [], addLoading: false }); return }
    this._addTimer = setTimeout(() => this.searchFoods(keyword), 250)
  },
  searchFoods(keyword) {
    this._addTimer = null
    const seq = (this._addSearchSeq || 0) + 1
    this._addSearchSeq = seq
    this.setData({ addLoading: true })
    fetchFoods({ keyword, pageNum: 1, pageSize: 20 })
      .then((page) => {
        if (seq !== this._addSearchSeq || !this.data.addSheetVisible) return
        const results = ((page && page.records) || []).map((food) => ({
          ...food,
          per100Text: '每100g：碳水 ' + (food.carbs == null ? '未知' : food.carbs + 'g')
            + ' · 热量 ' + (food.cal == null ? '未知' : food.cal + 'kcal')
            + (food.gi == null ? '' : ' · GI ' + food.gi)
        }))
        this.setData({ addResults: results, addLoading: false })
      })
      .catch(() => {
        if (seq !== this._addSearchSeq) return
        this.setData({ addResults: [], addLoading: false })
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
      })
  },
  onAddResultTap(e) {
    if (this.data.busy) return
    const food = this.data.addResults[Number(e.currentTarget.dataset.index)]
    if (food) this.applyPickedFood(food)
  },
  onSwitchAddMode(e) {
    const mode = e.currentTarget.dataset.mode === 'custom' ? 'custom' : 'search'
    if (mode === 'custom' && !this.data.addReplacing && this.data.items.length >= 50) {
      wx.showToast({ title: '最多添加 50 项食物', icon: 'none' })
      return
    }
    this.setData({ addMode: mode })
  },
  applyPickedFood(food) {
    if (!food || food.id == null) {
      wx.showToast({ title: '该食物暂不支持选择', icon: 'none' })
      return
    }
    const index = typeof this._editingIndex === 'number' ? this._editingIndex : -1
    const current = index >= 0 ? this.data.items[index] : null
    if (!current && this.data.items.length >= 50) {
      wx.showToast({ title: '最多添加 50 项食物', icon: 'none' })
      return
    }
    const weightInput = current ? current.weightInput : '100'
    const baseWeight = current ? current.baseWeight : '100'
    const per100Text = food.carbs == null || food.cal == null ? '营养未知，不计入总量'
      : '每100g：碳水 ' + food.carbs + 'g · 热量 ' + food.cal + 'kcal'
        + (food.gi == null ? '' : ' · GI ' + food.gi)
    const picked = {
      key: current ? current.key : 'food-' + Date.now() + '-' + this.data.items.length,
      foodId: food.id,
      libraryFoodId: null,
      foodName: food.name || '未命名食物',
      categoryCode: food.categoryCode == null ? null : food.categoryCode,
      giValue: food.gi == null ? null : food.gi,
      carbsPer100g: food.carbs == null ? null : food.carbs,
      caloriesPer100g: food.cal == null ? null : food.cal,
      nutritionSource: 'LIBRARY',
      confidence: null,
      needsConfirmation: false,
      userCorrected: true,
      weightInput,
      baseWeight,
      sourceText: '食品库数据',
      per100Text
    }
    const items = current
      ? this.data.items.map((item, position) => position === index ? picked : item)
      : this.data.items.concat(picked)
    this._editingIndex = -1
    this.setData({
      items,
      phase: 'ready',
      addSheetVisible: false,
      addReplacing: false,
      addMode: 'search',
      addKeyword: '',
      addResults: []
    })
    this.recalculate()
  },
  onToggleDeleteMode() {
    if (this.data.busy) return
    this.setData({ deleteMode: !this.data.deleteMode })
  },
  onExitModes() {
    this.setData({ deleteMode: false })
  },
  onSheetTap() {},
  onAddFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!['name', 'weight', 'carbs', 'calories'].includes(field)) return
    this.setData({ ['addForm.' + field]: e.detail.value })
  },
  onCancelAdd() {
    this.onCloseAddSheet()
    this.setData({ addForm: { name: '', weight: '', carbs: '', calories: '' } })
  },
  onConfirmAdd() {
    if (this.data.busy) return
    const form = this.data.addForm || {}
    const name = String(form.name || '').trim().slice(0, 64)
    const weight = numberOrNull(form.weight)
    const carbs = numberOrNull(form.carbs)
    const calories = numberOrNull(form.calories)
    if (!name) {
      wx.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }
    if (!(weight > 0 && weight <= 5000)) {
      wx.showToast({ title: '请输入 0-5000g 之间的重量', icon: 'none' })
      return
    }
    if ((form.carbs !== '' && (carbs === null || carbs < 0)) || (form.calories !== '' && (calories === null || calories < 0))) {
      wx.showToast({ title: '营养值需为非负数字', icon: 'none' })
      return
    }
    if (this.data.items.length >= 50) {
      wx.showToast({ title: '最多添加 50 项食物', icon: 'none' })
      return
    }
    const nutritionKnown = carbs !== null && calories !== null
    const picked = {
      key: 'food-' + Date.now() + '-' + this.data.items.length,
      foodId: null,
      libraryFoodId: null,
      foodName: name,
      categoryCode: null,
      giValue: null,
      carbsPer100g: nutritionKnown ? carbs : null,
      caloriesPer100g: nutritionKnown ? calories : null,
      nutritionSource: 'UNKNOWN',
      confidence: null,
      needsConfirmation: false,
      userCorrected: true,
      weightInput: String(weight),
      baseWeight: String(weight),
      sourceText: '手动添加',
      per100Text: nutritionKnown ? '每100g：碳水 ' + carbs + 'g · 热量 ' + calories + 'kcal' : '营养未知，不计入总量'
    }
    this.setData({ items: this.data.items.concat(picked), phase: 'ready',
      addSheetVisible: false, addReplacing: false, addMode: 'search', addKeyword: '', addResults: [],
      addForm: { name: '', weight: '', carbs: '', calories: '' } })
    this.recalculate()
  },
  onGoMeasure(e) {
    if (this.data.busy) return
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const nodeCode = dataset.node || BEFORE_MEAL[this.data.nodeId]
    if (!nodeCode) return
    const node = GLUCOSE_NODES.find((item) => item.id === nodeCode)
    // 只读上下文：先拍血糖仪照片，再由 food-confirm → confirm 完成 OCR 与入库，本页不写血糖库
    wx.navigateTo({
      url: '/pages/camera/camera?nodeId=' + nodeCode + '&nodeName=' + encodeURIComponent(node ? node.name : '血糖')
    })
  },
  onToggleFoodList() {
    this.setData({ foodListExpanded: !this.data.foodListExpanded })
  },
  onRetry() { return this.recognize() },
  onRetake() {
    if (this.data.busy) return
    clearShotImage()
    wx.redirectTo({ url: '/pages/camera/camera?nodeId=' + this.data.nodeId + '&isMeal=1&nodeName=' + encodeURIComponent(this.data.nodeName) })
  },

  async onSave() {
    if (this.data.phase !== 'ready' || this.data.busy || !this.data.analysisReady
      || this.data.pendingConfirmCount > 0) return
    if (!this.ensureLogin() || !this.ensureOpen()) return
    this.setData({ busy: true, saveError: '' })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const payload = {
        recordDate: this._recordDate, nodeCode: this.data.nodeId, mediaId: this.data.mediaId,
        foodsText: this.data.foodsText, carbsG: this.data.carbsG,
        supplementText: this.data.supplement || undefined,
        items: this.data.items.map((item) => ({
          foodId: item.foodId || undefined,
          libraryFoodId: item.libraryFoodId || undefined,
          foodName: item.foodName,
          categoryCode: item.categoryCode == null ? undefined : item.categoryCode,
          giValue: item.giValue == null ? undefined : item.giValue,
          nutritionSource: item.nutritionSource || undefined,
          confidence: item.confidence == null ? undefined : item.confidence,
          userCorrected: item.userCorrected === true,
          weightG: item.weightG,
          carbsG: item.carbsG,
          caloriesKcal: item.caloriesKcal,
          dishName: item.dishName || undefined,
          role: item.role || undefined,
          cookMethod: item.cookMethod || undefined
        }))
      }
      // 有识别令牌才带确认语义：无令牌（旧客户端/快照过期）后端不走低置信拦截
      if (this.data.analysisToken) {
        payload.analysisToken = this.data.analysisToken
        payload.confirmLowConfidence = this.data.pendingConfirmCount === 0
      }
      await saveMealRecord(payload)
      if (!this._alive) return
      // 预测已下线：本地缓存只保留餐食本身信息，不再写入任何预测字段
      saveRecord(this.data.nodeId, { type: 'meal', foods: this.data.foodsText, carbs: this.data.carbsG,
        supplement: this.data.supplement }, this._recordDate)
      clearShotImage()
      wx.showToast({ title: '饮食记录已保存', icon: 'success' })
      // 跳当天看板查看历史；用 redirectTo 避免返回栈残留已保存的识别页
      wx.redirectTo({ url: '/pages/stats/stats' })
    } catch (error) {
      if (this._alive) {
        if (error.code === 40100) this.ensureLogin()
        // 40001 等业务错误按后端原文回显，不清空用户输入
        else this.setData({ saveError: error.message || '保存失败，请重试' })
      }
    } finally {
      wx.hideLoading()
      if (this._alive) this.setData({ busy: false })
    }
  }
})
