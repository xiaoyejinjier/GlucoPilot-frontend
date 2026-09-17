const { saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    value: '6.8',
    manualEdit: false,
    busy: false
  },

  onLoad(options) {
    const nodeName = decodeURIComponent(options.nodeName || '早餐后')
    const imagePath = readShotImage()

    this.setData({
      nodeId: options.nodeId || 'after_breakfast',
      nodeName,
      value: options.value || '6.8',
      imagePath
    })
    wx.setNavigationBarTitle({ title: nodeName + ' · 确认入库' })
  },

  onShow() {
    applyDisplayToCurrentPage()
    const path = readShotImage()
    if (path && path !== this.data.imagePath) {
      this.setData({ imagePath: path })
    }
  },

  onBack() {
    if (this.data.busy) return
    wx.navigateBack()
  },

  onToggleManual() {
    this.setData({ manualEdit: !this.data.manualEdit })
  },

  onValueInput(e) {
    this.setData({ value: e.detail.value })
  },

  onConfirm() {
    if (this.data.busy) return
    const value = parseFloat(this.data.value)
    if (isNaN(value) || value <= 0 || value > 30) {
      wx.showToast({ title: '请输入有效血糖值', icon: 'none' })
      return
    }

    this.setData({ busy: true })
    clearShotImage()
    saveRecord(this.data.nodeId, { value, type: 'glucose' })
    wx.showToast({ title: '保存成功', icon: 'success' })
    setTimeout(() => {
      this.setData({ busy: false })
      wx.switchTab({ url: '/pages/ai/ai' })
    }, 800)
  }
})
