const { analyzeMealPhoto, saveMealRecord, predictMealGlucose, upsertGlucoseRecord } = require('../../services/api')
const { getTodayKey, getRecords, saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')
const { uploadMealImage } = require('../../utils/media')
const { getToken } = require('../../utils/request')
const { getNodeRecordWindow } = require('../../utils/record-window')
const { GLUCOSE_NODES } = require('../../utils/constants')

const BEFORE_MEAL = { breakfast: 'before_breakfast', lunch: 'before_lunch', dinner: 'before_dinner' }

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function rounded(value) { return Math.round(value * 10) / 10 }

/** 建议克重的份数提示：当前量≥50g 且削减>20g 时，比例贴近典型分数才标注。 */
function portionHint(currentG, suggestG) {
  if (!(currentG >= 50) || !(currentG - suggestG > 20)) return ''
  const ratio = suggestG / currentG
  if (Math.abs(ratio - 0.5) <= 0.08) return ' (减半)'
  if (Math.abs(ratio - 1 / 3) <= 0.08) return ' (约1/3)'
  if (Math.abs(ratio - 2 / 3) <= 0.08) return ' (约2/3)'
  return ''
}

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    busy: false,
    recognizing: false,
    analysisError: '',
    analysisReady: false,
    hasAnalysis: false,
    needsReanalysis: false,
    mediaId: '',
    items: [],
    warnings: [],
    matchedCount: 0,
    newFoodsCount: 0,
    model: '',
    supplement: '',
    currentGlucose: '',
    glucoseInput: '',
    beforeMealRecorded: false,
    foodListExpanded: false,
    foodsText: '',
    carbsG: null,
    caloriesKcal: null,
    predictResult: null,
    predictLoading: false,
    predictError: '',
    predictNotice: '',
    suggestCount: 0,
    metrics: { glucose: '—', carbs: '—', extra: '—' }
  },

  onLoad(options) {
    this._alive = true
    this._recordDate = getTodayKey()
    const nodeId = options.nodeId || 'breakfast'
    const records = getRecords(this._recordDate)
    const cached = records[BEFORE_MEAL[nodeId]]
    const glucose = cached && cached.type === 'glucose' ? numberOrNull(cached.value) : null
    const currentGlucose = glucose > 0 && glucose < 40 ? String(glucose) : ''
    this.setData({
      nodeId,
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath: readShotImage() || '',
      currentGlucose,
      glucoseInput: currentGlucose,
      beforeMealRecorded: !!(records[BEFORE_MEAL[nodeId]] || records[nodeId]),
      'metrics.glucose': currentGlucose || '—'
    })
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
      // 从「去拍照记录」返回：餐前血糖已入库，自动更新并重算预测。
      this.setData({ currentGlucose, glucoseInput: currentGlucose, 'metrics.glucose': currentGlucose })
      this.schedulePredict()
    }
    if (recorded !== this.data.beforeMealRecorded) this.setData({ beforeMealRecorded: recorded })
  },
  onUnload() {
    this._alive = false
    this._analysisVersion = (this._analysisVersion || 0) + 1
    this._predictVersion = (this._predictVersion || 0) + 1
    if (this._predictTimer) { clearTimeout(this._predictTimer); this._predictTimer = null }
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
    if (this.data.busy || !this.ensureLogin() || !this.ensureOpen()) return
    const version = (this._analysisVersion || 0) + 1
    this._analysisVersion = version
    this.clearPrediction()
    this.setData({ busy: true, recognizing: true, analysisReady: false, analysisError: '' })
    try {
      const mediaId = await this.ensureUploaded()
      if (!this._alive || version !== this._analysisVersion) return
      const input = { mediaId, nodeCode: this.data.nodeId, foodText: this.data.supplement.trim() || undefined }
      const fingerprint = JSON.stringify(input)
      if (this._analysisInput !== fingerprint) {
        this._analysisInput = fingerprint
        this._analysisKey = 'meal-' + Date.now() + '-' + Math.random().toString(36).slice(2)
      }
      const result = await analyzeMealPhoto(input, this._analysisKey)
      if (!this._alive || version !== this._analysisVersion) return
      if (!result || !Array.isArray(result.items) || !result.items.length) {
        throw new Error('没有识别到食物，请补充说明或重新拍照')
      }
      const items = result.items.map((item, index) => ({
        ...item,
        key: 'food-' + index,
        weightInput: item.weightG == null ? '' : String(item.weightG),
        sourceText: item.nutritionSource === 'AI_ESTIMATE' ? '模型估算 · 待审核'
          : item.nutritionSource === 'LIBRARY' ? '食品库数据' : '待确认',
        per100Text: item.carbsPer100g == null || item.caloriesPer100g == null ? '营养不确定，请补充信息后重新识别'
          : '每100g：碳水 ' + item.carbsPer100g + 'g · 热量 ' + item.caloriesPer100g + 'kcal'
            + (item.giValue == null ? '' : ' · GI ' + item.giValue)
      }))
      this.setData({
        mediaId, items, hasAnalysis: true, needsReanalysis: false, foodListExpanded: false,
        warnings: result.warnings || [],
        matchedCount: result.matchedCount || 0,
        newFoodsCount: result.newFoodsCount || 0,
        model: result.model || ''
      })
      this.recalculate()
    } catch (error) {
      if (!this._alive || version !== this._analysisVersion) return
      this.setData({ analysisError: error.message || '识别失败，请重试', analysisReady: false })
      if (error.code === 40100) this.ensureLogin()
    } finally {
      if (this._alive && version === this._analysisVersion) {
        this.setData({ busy: false, recognizing: false })
      }
    }
  },

  recalculate() {
    let ready = this.data.items.length > 0 && !this.data.needsReanalysis
    let carbs = 0
    let calories = 0
    const items = this.data.items.map((item) => {
      const weight = numberOrNull(item.weightInput)
      const perCarbs = numberOrNull(item.carbsPer100g)
      const perCalories = numberOrNull(item.caloriesPer100g)
      const complete = weight > 0 && weight <= 5000 && perCarbs !== null && perCarbs >= 0
        && perCalories !== null && perCalories >= 0 && item.nutritionSource !== 'UNKNOWN'
      if (!complete) ready = false
      const itemCarbs = complete ? rounded(weight * perCarbs / 100) : null
      const itemCalories = complete ? rounded(weight * perCalories / 100) : null
      if (complete) { carbs += itemCarbs; calories += itemCalories }
      return { ...item, weightG: weight, carbsG: itemCarbs, caloriesKcal: itemCalories,
        portionText: complete ? '本份：碳水 ' + itemCarbs + 'g · 热量 ' + itemCalories + 'kcal' : '请确认重量及营养' }
    })
    this.setData({
      items, analysisReady: ready,
      carbsG: ready ? rounded(carbs) : null,
      caloriesKcal: ready ? rounded(calories) : null,
      foodsText: items.map((item) => item.foodName + (item.weightG > 0 ? ' ' + item.weightG + 'g' : '（重量待确认）')).join('、').slice(0, 512),
      metrics: { glucose: this.data.currentGlucose || '—', carbs: ready ? rounded(carbs) + 'g' : '待确认',
        extra: ready ? rounded(calories) + 'kcal' : '待确认' }
    })
    // 预测依赖营养完整度与餐前血糖；识别结果/重量变化后防抖重算。
    this.schedulePredict()
  },

  clearPrediction() {
    this._predictVersion = (this._predictVersion || 0) + 1
    if (this._predictTimer) { clearTimeout(this._predictTimer); this._predictTimer = null }
    this.setData({ predictResult: null, predictLoading: false, predictError: '', predictNotice: '', suggestCount: 0 })
  },

  schedulePredict() {
    if (!this._alive) return
    if (this._predictTimer) clearTimeout(this._predictTimer)
    this._predictTimer = setTimeout(() => { this._predictTimer = null; this.predict() }, 800)
  },

  buildPredictInput() {
    const items = this.data.items || []
    // 方案 B：预测请求只带已分类且营养完整的食物，碳水同步扣减；保存仍用全量。
    const validItems = items.filter((item) => {
      const code = Number(item.categoryCode)
      return code >= 1 && code <= 9 && item.weightG > 0 && item.carbsG != null
    })
    return {
      ready: this.data.hasAnalysis && !this.data.needsReanalysis && !this.data.analysisError && this.data.analysisReady,
      dropped: items.length - validItems.length,
      carbsG: rounded(validItems.reduce((sum, item) => sum + item.carbsG, 0)),
      glucose: numberOrNull(this.data.currentGlucose),
      validItems
    }
  },

  /** 预测/保存共用同一指纹算法：nodeCode + 血糖 + 有效明细碳水，二者必须完全一致。 */
  predictFingerprint(input) {
    return [this.data.nodeId, input.glucose, input.carbsG,
      input.validItems.map((item) => [item.foodName, item.categoryCode, item.weightG, item.carbsG].join(':')).join('|')].join('#')
  },

  async predict() {
    if (!this._alive) return
    const version = (this._predictVersion || 0) + 1
    this._predictVersion = version
    const input = this.buildPredictInput()
    if (!input.ready || !input.validItems.length || !(input.glucose > 0 && input.glucose < 40)) {
      // 空态：营养未确认 / 无有效食物 / 未录餐前血糖，均不发起预测。
      this.setData({ predictResult: null, predictLoading: false, predictError: '', predictNotice: '' })
      return
    }
    const fingerprint = this.predictFingerprint(input)
    this._predictFingerprint = fingerprint
    this.setData({
      predictLoading: true, predictError: '',
      predictNotice: input.dropped > 0 ? input.dropped + ' 项未分类食物未纳入预测' : ''
    })
    try {
      const result = await predictMealGlucose({
        nodeCode: this.data.nodeId,
        currentGlucose: input.glucose,
        carbsG: input.carbsG,
        items: input.validItems.map((item) => ({ foodName: item.foodName, categoryCode: Number(item.categoryCode),
          weightG: item.weightG, carbsG: item.carbsG }))
      })
      if (!this._alive || version !== this._predictVersion || fingerprint !== this._predictFingerprint) return
      if (!result || !Number.isFinite(result.predictNow) || !Number.isFinite(result.predictSuggest)) {
        throw new Error('预测返回数据无效，请重试')
      }
      const suggestItems = Array.isArray(result.suggestItems) ? result.suggestItems : []
      const suggestMap = {}
      for (const suggest of suggestItems) {
        suggestMap[suggest.foodName] = suggest.suggestWeight == null ? null : Number(suggest.suggestWeight)
      }
      // 局部路径写回建议，避免全量 items 覆盖导致输入框失焦
      const updates = {
        suggestCount: suggestItems.length,
        predictResult: { predictNow: result.predictNow, predictSuggest: result.predictSuggest,
          suggestText: result.suggestText || '', predictCarbs: input.carbsG,
          suggestCarbs: result.suggestCarbs == null ? null : result.suggestCarbs,
          fingerprint }
      }
      this.data.items.forEach((item, index) => {
        const matched = Object.prototype.hasOwnProperty.call(suggestMap, item.foodName)
        const weight = matched ? suggestMap[item.foodName] : null
        // suggestMatched 区分「未进建议名单」（隐藏）与「正常 null」（显示）；undefined 无法经 setData 可靠清除
        updates['items[' + index + '].suggestMatched'] = matched
        updates['items[' + index + '].suggestWeight'] = weight
        updates['items[' + index + '].suggestHint'] = weight > 0 ? portionHint(item.weightG, weight) : ''
      })
      this.setData(updates)
    } catch (error) {
      // P4：失败即清空，保存时不再携带上一次的预测值。
      if (this._alive && version === this._predictVersion && fingerprint === this._predictFingerprint) {
        this.setData({ predictResult: null, predictError: error.message || '预测失败，可重试；不影响饮食保存' })
        if (error.code === 40100) this.ensureLogin()
      }
    } finally {
      if (this._alive && version === this._predictVersion && fingerprint === this._predictFingerprint) {
        this.setData({ predictLoading: false })
      }
    }
  },

  onRetryPredict() {
    if (this.data.busy || this.data.predictLoading) return
    return this.predict()
  },

  onWeightInput(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    if (!this.data.items[index]) return
    const items = this.data.items.map((item, position) => position === index ? { ...item, weightInput: e.detail.value } : item)
    this.setData({ items })
    this.recalculate()
  },
  onSupplementInput(e) {
    this.setData({ supplement: e.detail.value })
    if (this.data.hasAnalysis) {
      this.setData({ analysisReady: false, needsReanalysis: true })
      this.clearPrediction()
    }
  },
  onGlucoseInput(e) {
    // 仅更新草稿，点击「确定」才生效并触发预测重算。
    this.setData({ glucoseInput: e.detail.value })
  },
  async onConfirmGlucose() {
    if (this.data.busy || this.data.predictLoading) return
    const raw = String(this.data.glucoseInput || '').trim()
    const value = numberOrNull(raw)
    const fraction = (raw.split('.')[1] || '').replace(/0+$/, '')
    if (value === null || fraction.length > 1 || value < 0.1 || value > 39.9) {
      wx.showToast({ title: '请输入 0.1-39.9 之间、最多 1 位小数的血糖值', icon: 'none' })
      return
    }
    if (!this.ensureLogin() || !this.ensureOpen()) return
    this.setData({ busy: true })
    try {
      // 与拍照打卡同链路：先落库，成功后写本地缓存并隐藏输入卡
      await upsertGlucoseRecord({
        recordDate: this._recordDate,
        nodeCode: BEFORE_MEAL[this.data.nodeId],
        glucoseValue: value,
        sourceType: 1
      })
      saveRecord(BEFORE_MEAL[this.data.nodeId], { value, type: 'glucose' }, this._recordDate)
      const currentGlucose = String(value)
      this.setData({ currentGlucose, 'metrics.glucose': currentGlucose, glucoseInput: '', beforeMealRecorded: true })
      this.schedulePredict()
    } catch (error) {
      if (error.code === 40100) this.ensureLogin()
      else wx.showToast({ title: error.message || '血糖保存失败，请重试', icon: 'none' })
    } finally {
      if (this._alive) this.setData({ busy: false })
    }
  },
  onGoMeasure() {
    if (this.data.busy) return
    const beforeNode = BEFORE_MEAL[this.data.nodeId]
    const window = getNodeRecordWindow(beforeNode, new Date())
    if (window.locked) {
      wx.showModal({ title: '该时段已截止', content: window.lockReason, showCancel: false, confirmText: '知道了' })
      return
    }
    const node = GLUCOSE_NODES.find((item) => item.id === beforeNode)
    wx.navigateTo({
      url: '/pages/camera/camera?nodeId=' + beforeNode + '&isMeal=0&nodeName=' + encodeURIComponent(node ? node.name : '餐前')
    })
  },
  onToggleFoodList() {
    this.setData({ foodListExpanded: !this.data.foodListExpanded })
  },
  onRetry() { return this.recognize() },
  onReAnalyze() { return this.recognize() },
  onRetake() {
    if (this.data.busy) return
    clearShotImage()
    wx.redirectTo({ url: '/pages/camera/camera?nodeId=' + this.data.nodeId + '&isMeal=1&nodeName=' + encodeURIComponent(this.data.nodeName) })
  },

  async onSave() {
    if (this.data.busy || !this.data.analysisReady || !this.ensureLogin() || !this.ensureOpen()) return
    this.setData({ busy: true })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      // 预测值与当前输入必须同源：防抖/在途窗口内改了重量或血糖就丢弃旧预测，避免「新碳水 + 旧预测」落库
      const prediction = this.data.predictResult
      const currentFingerprint = this.predictFingerprint(this.buildPredictInput())
      const validPrediction = prediction && prediction.fingerprint === currentFingerprint ? prediction : null
      await saveMealRecord({
        recordDate: this._recordDate, nodeCode: this.data.nodeId, mediaId: this.data.mediaId,
        foodsText: this.data.foodsText, carbsG: this.data.carbsG,
        supplementText: this.data.supplement || undefined,
        ...(validPrediction ? { predictNow: validPrediction.predictNow, predictSuggest: validPrediction.predictSuggest,
          suggestText: validPrediction.suggestText || undefined } : {}),
        items: this.data.items.map((item) => ({ foodId: item.foodId || undefined, foodName: item.foodName,
          weightG: item.weightG, carbsG: item.carbsG, caloriesKcal: item.caloriesKcal }))
      })
      if (!this._alive) return
      saveRecord(this.data.nodeId, { type: 'meal', foods: this.data.foodsText, carbs: this.data.carbsG,
        supplement: this.data.supplement,
        predictedGlucose: validPrediction ? validPrediction.predictNow : null,
        suggestedGlucose: validPrediction ? validPrediction.predictSuggest : null }, this._recordDate)
      clearShotImage()
      wx.showToast({ title: '饮食记录已保存', icon: 'success' })
      wx.switchTab({ url: '/pages/ai/ai' })
    } catch (error) {
      if (this._alive) {
        if (error.code === 40100) this.ensureLogin()
        else wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      if (this._alive) this.setData({ busy: false })
    }
  }
})
