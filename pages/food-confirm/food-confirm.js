const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage, persistShotImage } = require('../../utils/shot')
const { getNodeRecordWindow } = require('../../utils/record-window')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    busy: false
  },

  onLoad(options) {
    const nodeId = options.nodeId || 'breakfast'
    const imagePath = readShotImage() || ''

    this.setData({
      nodeId,
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath
    })
    this.rejectClosedWindow(nodeId)
  },

  onShow() {
    applyDisplayToCurrentPage()
    // 再读一次，防止 onLoad 时序早于写入
    const path = readShotImage()
    if (path && path !== this.data.imagePath) {
      this.setData({ imagePath: path })
    }
  },

  onImgError() {
    this.setData({ imagePath: '' })
    wx.showToast({ title: '照片无法读取，请重新拍摄', icon: 'none' })
  },

  onImgLoad() {
    // 加载成功无需处理
  },

  onRetake() {
    if (this.data.busy) return
    clearShotImage()
    wx.navigateBack({
      fail: () => {
        const { nodeId, nodeName } = this.data
        wx.redirectTo({
          url: `/pages/camera/camera?nodeId=${nodeId}&isMeal=1&nodeName=${encodeURIComponent(nodeName)}`
        })
      }
    })
  },

  onConfirm() {
    if (this.data.busy) return
    if (!this.data.imagePath) {
      wx.showToast({ title: '请先拍摄餐食照片', icon: 'none' })
      return
    }
    if (this.rejectClosedWindow(this.data.nodeId)) return
    this.setData({ busy: true })
    wx.showLoading({ title: '准备照片...', mask: true })
    const { nodeId, nodeName, imagePath } = this.data
    persistShotImage(imagePath).then(() => {
      wx.hideLoading()
      wx.redirectTo({
        url: `/pages/food-analysis/food-analysis?nodeId=${nodeId}&nodeName=${encodeURIComponent(nodeName)}`,
        complete: () => this.setData({ busy: false })
      })
    }).catch((error) => {
      wx.hideLoading()
      this.setData({ busy: false })
      wx.showToast({ title: error.message || '照片保存失败，请重新拍照', icon: 'none' })
    })
  },

  rejectClosedWindow(nodeId) {
    const recordWindow = getNodeRecordWindow(nodeId, new Date())
    if (!recordWindow.locked) return false
    if (this._windowModalVisible) return true
    this._windowModalVisible = true
    wx.showModal({
      title: '该时段已截止',
      content: recordWindow.lockReason,
      showCancel: false,
      confirmText: '返回记录页',
      complete: () => {
        this._windowModalVisible = false
        clearShotImage()
        wx.switchTab({ url: '/pages/ai/ai' })
      }
    })
    return true
  }
})
