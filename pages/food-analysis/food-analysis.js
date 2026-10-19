const { analyzeMealPhoto, saveMealRecord, predictMealGlucose } = require('../../services/api')
const { getTodayKey, getRecords, saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')
const { uploadMealImage } = require('../../utils/media')
const { getToken } = require('../../utils/request')
const { getNodeRecordWindow } = require('../../utils/record-window')

const HUNGER_LEVEL = { 饱腹: 1, 一般: 2, 微饿: 3 }
const BEFORE_MEAL = { breakfast: 'before_breakfast', lunch: 'before_lunch', dinner: 'before_dinner' }

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function rounded(value) { return Math.round(value * 10) / 10 }

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
    hunger: '一般',
    hungerOptions: ['饱腹', '一般', '微饿'],
    currentGlucose: '',
    foodsText: '',
    carbsG: null,
    caloriesKcal: null,
    predictResult: null,
    predictLoading: false,
    predictError: '',
    predictNotice: '',
    metrics: { glucose: '—', carbs: '—', extra: '—' }
  },

  onLoad(options) {
    this._alive = true
    this._recordDate = getTodayKey()
    const nodeId = options.nodeId || 'breakfast'
    const cached = getRecords(this._recordDate)[BEFORE_MEAL[nodeId]]
    const glucose = cached && cached.type === 'glucose' ? numberOrNull(cached.value) : null
    const currentGlucose = glucose > 0 && glucose < 40 ? String(glucose) : ''
    this.setData({
      nodeId,
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath: readShotImage() || '',
      currentGlucose,
      'metrics.glucose': currentGlucose || '—'
    })
    return this.recognize()
  },

  onShow() { applyDisplayToCurrentPage() },
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
        mediaId, items, hasAnalysis: true, needsReanalysis: false,
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
    this.setData({ predictResult: null, predictLoading: false, predictError: '', predictNotice: '' })
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
    const fingerprint = [this.data.nodeId, input.glucose, input.carbsG,
      input.validItems.map((item) => [item.foodName, item.categoryCode, item.weightG, item.carbsG].join(':')).join('|')].join('#')
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
      this.setData({ predictResult: { predictNow: result.predictNow, predictSuggest: result.predictSuggest,
        suggestText: result.suggestText || '', predictCarbs: input.carbsG } })
    } catch (error) {
      // P4：失败即清空，保存时不再携带上一次的预测值。
      if (this._alive && version === this._predictVersion && fingerprint === this._predictFingerprint) {
        this.setData({ predictResult: null, predictError: error.message || '预测失败，可重试；不影响饮食保存' })
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
  onHunger(e) {
    if (this.data.busy) return
    // 饥饿感不是预测入参，仅随饮食保存落库，不触发预测重算。
    this.setData({ hunger: e.currentTarget.dataset.val })
  },
  onSupplementInput(e) {
    this.setData({ supplement: e.detail.value })
    if (this.data.hasAnalysis) {
      this.setData({ analysisReady: false, needsReanalysis: true })
      this.clearPrediction()
    }
  },
  onCurrentGlucoseInput(e) {
    this.setData({ currentGlucose: e.detail.value, 'metrics.glucose': e.detail.value || '—' })
    this.schedulePredict()
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
      const prediction = this.data.predictResult
      await saveMealRecord({
        recordDate: this._recordDate, nodeCode: this.data.nodeId, mediaId: this.data.mediaId,
        foodsText: this.data.foodsText, carbsG: this.data.carbsG,
        hungerLevel: HUNGER_LEVEL[this.data.hunger] || 2, supplementText: this.data.supplement || undefined,
        ...(prediction ? { predictNow: prediction.predictNow, predictSuggest: prediction.predictSuggest,
          suggestText: prediction.suggestText || undefined } : {}),
        items: this.data.items.map((item) => ({ foodId: item.foodId || undefined, foodName: item.foodName,
          weightG: item.weightG, carbsG: item.carbsG, caloriesKcal: item.caloriesKcal }))
      })
      if (!this._alive) return
      saveRecord(this.data.nodeId, { type: 'meal', foods: this.data.foodsText, carbs: this.data.carbsG,
        hunger: this.data.hunger, supplement: this.data.supplement,
        predictedGlucose: prediction ? prediction.predictNow : null,
        suggestedGlucose: prediction ? prediction.predictSuggest : null }, this._recordDate)
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
