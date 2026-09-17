const { FEEDBACK_TYPES } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    types: FEEDBACK_TYPES,
    activeType: '产品建议',
    content: ''
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onTypeTap(e) {
    this.setData({ activeType: e.currentTarget.dataset.type })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onSubmit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    const list = wx.getStorageSync('feedbackList') || []
    const now = new Date()
    const p = (n) => String(n).padStart(2, '0')
    list.unshift({
      id: Date.now(),
      type: this.data.activeType,
      content: this.data.content.trim(),
      status: '已收到',
      time: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
    })
    wx.setStorageSync('feedbackList', list)
    this.setData({ content: '' })
    wx.showToast({ title: '提交成功', icon: 'none' })
  },

  onViewList() {
    wx.navigateTo({ url: '/pages/feedback-list/feedback-list' })
  }
})
