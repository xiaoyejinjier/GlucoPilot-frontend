const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage, persistShotImage } = require('../../utils/shot')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    busy: false
  },

  onLoad(options) {
    const imagePath = readShotImage() || '/assets/foods/rice.svg'

    this.setData({
      nodeId: options.nodeId || 'breakfast',
      nodeName: decodeURIComponent(options.nodeName || '早餐'),
      imagePath
    })
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
    const fallback = '/assets/foods/rice.svg'
    if (this.data.imagePath !== fallback) {
      this.setData({ imagePath: fallback })
    }
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
    this.setData({ busy: true })
    wx.showLoading({ title: '分析中...', mask: true })
    const { nodeId, nodeName, imagePath } = this.data
    persistShotImage(imagePath).then(() => {
      wx.hideLoading()
      wx.redirectTo({
        url: `/pages/food-analysis/food-analysis?nodeId=${nodeId}&nodeName=${encodeURIComponent(nodeName)}`,
        complete: () => this.setData({ busy: false })
      })
    })
  }
})
