const i18n = require('../../utils/i18n')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: {
    locale: i18n.getLocale(),
    displayStyle: ''
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.setData({ locale: i18n.getLocale() })
  }
})
