const { DISCLAIMER_CONTENT } = require('../../utils/constants')

Page({
  data: {
    paragraphs: DISCLAIMER_CONTENT,
    canAgree: false
  },

  onScrollToBottom() {
    if (!this.data.canAgree) {
      this.setData({ canAgree: true })
    }
  },

  onAgree() {
    if (!this.data.canAgree) return
    wx.setStorageSync('disclaimerAgreed', true)
    wx.showToast({ title: '已同意', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 1200)
  }
})
