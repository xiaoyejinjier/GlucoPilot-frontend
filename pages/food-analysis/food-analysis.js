const { saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    busy: false,
    supplement: '',
    hunger: '一般',
    hungerOptions: ['饱腹', '一般', '微饿'],
    foodsText: '米饭 + 红烧肉 + 青菜 · 碳水约 75g',
    suggestText: '米饭 100g · 红烧肉 60g · 青菜正常',
    predictNow: '10.2',
    predictSuggest: '7.8',
    metrics: {
      glucose: '6.1',
      carbs: '75g',
      extra: '—'
    }
  },

  onLoad(options) {
    const imagePath = readShotImage() || '/assets/foods/rice.jpg'
    this.setData({
      nodeId: options.nodeId || 'breakfast',
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath
    })
  },

  onShow() {
    applyDisplayToCurrentPage()
    const path = readShotImage()
    if (path && path !== this.data.imagePath) {
      this.setData({ imagePath: path })
    }
  },

  onHunger(e) {
    this.setData({ hunger: e.currentTarget.dataset.val })
  },

  onSupplementInput(e) {
    this.setData({ supplement: e.detail.value })
  },

  onVoiceFill() {
    if (this.data.busy) return
    this.setData({
      supplement: '米饭只吃了一半，红烧肉少吃两块，青菜正常'
    })
    wx.showToast({ title: '已填入补充信息', icon: 'none', duration: 1200 })
  },

  onRePredict() {
    if (this.data.busy) return
    const text = (this.data.supplement || '').trim()
    if (!text) {
      wx.showToast({ title: '请先补充饮食信息', icon: 'none' })
      return
    }

    this.setData({ busy: true })
    wx.showLoading({ title: '重新预测...', mask: true })

    setTimeout(() => {
      const now = (parseFloat(this.data.predictNow) - 0.6).toFixed(1)
      const suggest = (parseFloat(this.data.predictSuggest) - 0.4).toFixed(1)
      this.setData({
        predictNow: now,
        predictSuggest: suggest,
        foodsText: `米饭 + 红烧肉 + 青菜（已按补充调整）· 碳水约 55g`,
        suggestText: '米饭 70g · 红烧肉 40g · 青菜正常',
        metrics: {
          glucose: this.data.metrics.glucose,
          carbs: '55g',
          extra: '—'
        },
        busy: false
      })
      wx.hideLoading()
      wx.showToast({ title: '预测已更新', icon: 'success' })
    }, 450)
  },

  onSave() {
    if (this.data.busy) return
    this.setData({ busy: true })

    clearShotImage()

    saveRecord(this.data.nodeId, {
      type: 'meal',
      foods: this.data.foodsText,
      carbs: parseInt(this.data.metrics.carbs, 10) || 75,
      hunger: this.data.hunger,
      predictedGlucose: parseFloat(this.data.predictNow),
      suggestedGlucose: parseFloat(this.data.predictSuggest),
      supplement: this.data.supplement
    })

    wx.showToast({ title: '饮食记录已保存', icon: 'success' })
    setTimeout(() => {
      this.setData({ busy: false })
      wx.switchTab({ url: '/pages/ai/ai' })
    }, 800)
  }
})
