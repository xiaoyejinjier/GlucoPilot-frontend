const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    initialKeyword: ''
  },

  onLoad(options) {
    this.setData({ initialKeyword: String((options && options.q) || '') })
  },

  onShow() {
    if (!getApp().checkLogin()) return
    applyDisplayToCurrentPage()
  }
})
