const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage, persistShotImage } = require('../../utils/shot')
const { getNodeRecordWindow } = require('../../utils/record-window')
const { GLUCOSE_NODES } = require('../../utils/constants')
const { getToken } = require('../../utils/request')
const { getTodayKey } = require('../../utils/storage')
const { recognizeGlucoseImage, clearPendingOcr } = require('../../utils/ocr/index')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    isMeal: true,
    busy: false
  },

  onLoad(options) {
    this._alive = true
    this._photoToken = getToken()
    this._recordDate = getTodayKey()
    const nodeId = options.nodeId || 'breakfast'
    const imagePath = readShotImage() || ''
    const node = GLUCOSE_NODES.find(item => item.id === nodeId)

    this.setData({
      nodeId,
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      isMeal: node ? !!node.isMeal : options.isMeal !== '0',
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

  onUnload() {
    this._alive = false
    if (this._loading) { wx.hideLoading(); this._loading = false }
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
    if (!this.data.isMeal) clearPendingOcr()
    wx.navigateBack({
      fail: () => {
        const { nodeId, nodeName } = this.data
        wx.redirectTo({
          url: `/pages/camera/camera?nodeId=${nodeId}&isMeal=${this.data.isMeal ? 1 : 0}&nodeName=${encodeURIComponent(nodeName)}`
        })
      }
    })
  },

  async onConfirm() {
    if (this.data.busy) return
    if (!this.data.imagePath) {
      wx.showToast({ title: this.data.isMeal ? '请先拍摄餐食照片' : '请先拍摄血糖仪照片', icon: 'none' })
      return
    }
    if (this.rejectClosedWindow(this.data.nodeId)) return
    if (!getToken()) {
      wx.showToast({ title: '请重新登录后识别照片', icon: 'none' })
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (this._photoToken !== getToken()) {
      wx.switchTab({ url: '/pages/ai/ai' })
      return
    }
    this.setData({ busy: true })
    this._loading = true
    const { nodeId, nodeName, imagePath, isMeal } = this.data
    const token = getToken()
    const isCurrent = () => this._alive && getToken() === token
    wx.showLoading({ title: isMeal ? '准备照片...' : '上传并识别中...', mask: true })
    try {
      const savedPath = await persistShotImage(imagePath)
      if (!isCurrent()) return
      if (!isMeal) await recognizeGlucoseImage(savedPath || imagePath, { isCurrent })
      if (!isCurrent() || this.rejectClosedWindow(nodeId)) return
      await new Promise((resolve, reject) => wx.redirectTo({
        url: `/pages/${isMeal ? 'food-analysis/food-analysis' : 'confirm/confirm'}?nodeId=${nodeId}&nodeName=${encodeURIComponent(nodeName)}`,
        success: resolve,
        fail: reject
      }))
    } catch (error) {
      if (isCurrent()) wx.showToast({ title: error.message || '照片处理失败，请重试', icon: 'none' })
    } finally {
      if (this._loading) { wx.hideLoading(); this._loading = false }
      if (this._alive) {
        this.setData({ busy: false })
        if (!getToken()) wx.reLaunch({ url: '/pages/login/login' })
      }
    }
  },

  rejectClosedWindow(nodeId) {
    const recordWindow = getNodeRecordWindow(nodeId, new Date())
    const dateChanged = this._recordDate && this._recordDate !== getTodayKey()
    if (!recordWindow.locked && !dateChanged) return false
    if (this._windowModalVisible) return true
    this._windowModalVisible = true
    wx.showModal({
      title: '该时段已截止',
      content: dateChanged ? '拍照日期已变化，请返回记录页重新拍照。' : recordWindow.lockReason,
      showCancel: false,
      confirmText: '返回记录页',
      complete: () => {
        this._windowModalVisible = false
        clearShotImage()
        if (!this.data.isMeal) clearPendingOcr()
        wx.switchTab({ url: '/pages/ai/ai' })
      }
    })
    return true
  }
})
