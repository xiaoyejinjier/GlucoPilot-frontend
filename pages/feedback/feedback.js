const { FEEDBACK_TYPES } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { submitFeedback } = require('../../services/api')

Page({
  data: {
    displayStyle: '',
    types: FEEDBACK_TYPES,
    activeTypeIndex: 0,
    content: '',
    submitting: false
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onTypeTap(e) {
    this.setData({ activeTypeIndex: Number(e.currentTarget.dataset.index) })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onSubmit() {
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    this.setData({ submitting: true })
    // 端上顺序与后端 feedback_type 1~4 一一对应
    submitFeedback(this.data.activeTypeIndex + 1, content)
      .then(() => {
        this.setData({ submitting: false, content: '' })
        wx.showToast({ title: '提交成功', icon: 'none' })
      })
      .catch((err) => {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || '提交失败', icon: 'none' })
      })
  },

  onViewList() {
    wx.navigateTo({ url: '/pages/feedback-list/feedback-list' })
  }
})
