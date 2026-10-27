const { applyDisplayToCurrentPage } = require('../../utils/display')
const i18n = require('../../utils/i18n')
Page({
  data:{locale:i18n.getLocale()},
  onShow(){applyDisplayToCurrentPage();this.setData({locale:i18n.getLocale()})},
  onLanguage(event){
    const locale=event.currentTarget.dataset.locale
    if(!['zh-CN','en'].includes(locale)||locale===i18n.getLocale())return
    i18n.setLocale(locale)
    this.setData({locale})
    wx.showToast({title:i18n.t('语言已切换'),icon:'none'})
  },
  onNav(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
