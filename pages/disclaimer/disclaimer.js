const { DISCLAIMER_CONTENT } = require('../../utils/constants')
const { fetchAppConfig, agreeDisclaimer } = require('../../services/api')
const app = getApp()

Page({
  data: {
    displayStyle: '',
    paragraphs: DISCLAIMER_CONTENT,
    version: '',
    forced: false,
    canAgree: false,
    submitting: false
  },

  onLoad(options) {
    this.setData({ forced: !!(options && options.forced === '1') })
    this.loadDisclaimer()
  },

  loadDisclaimer() {
    // 文案与版本号以后端 sys_config 为准，接口不可用时退回本地文案
    return fetchAppConfig(['TEXT'])
      .then((config) => {
        const text = (config && config.TEXT) || {}
        const body = text['text.disclaimer']
        const version = String(text['text.disclaimer.version'] || '').trim()
        if (version) {
          wx.setStorageSync('disclaimerCurrentVersion', version)
          app.globalData.disclaimerCurrentVersion = version
        }
        this.setData({
          paragraphs: body ? [body].concat(DISCLAIMER_CONTENT.slice(1)) : DISCLAIMER_CONTENT,
          version,
          canAgree: false,
          submitting: false
        })
      })
      .catch(() => null)
  },

  onScrollToBottom() {
    if (!this.data.canAgree) {
      this.setData({ canAgree: true })
    }
  },

  onAgree() {
    if (!this.data.canAgree || this.data.submitting) return
    if (!this.data.version) {
      wx.showToast({ title: '免责声明版本未获取到，请稍后重试', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    agreeDisclaimer(this.data.version)
      .then(() => {
        if (typeof app.markDisclaimerAgreed === 'function') {
          app.markDisclaimerAgreed(this.data.version)
        }
        wx.showToast({ title: '已同意', icon: 'success' })
        setTimeout(() => {
          if (this.data.forced) {
            wx.switchTab({ url: '/pages/index/index' })
          } else {
            wx.navigateBack()
          }
        }, 800)
      })
      .catch((err) => {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || '提交失败', icon: 'none' })
        if (err && err.code === 40001) this.loadDisclaimer()
      })
  }
})
