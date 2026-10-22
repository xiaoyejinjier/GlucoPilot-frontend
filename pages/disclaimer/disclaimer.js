const { DISCLAIMER_CONTENT } = require('../../utils/constants')
const { fetchAppConfig, agreeDisclaimer } = require('../../services/api')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const app = getApp()
const BOTTOM_TOLERANCE = 2

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
    if (!this.checkAuthenticated()) return
    this.setData({ forced: !!(options && options.forced === '1') })
    return this.loadDisclaimer()
  },

  onShow() {
    this._hidden = false
    this._scrollHeight = 0
    applyDisplayToCurrentPage()
    this.measureReadPosition()
  },

  onReady() {
    this._viewReady = true
    this.measureReadPosition()
  },

  onResize() {
    this._scrollHeight = 0
    this.measureReadPosition()
  },

  onHide() {
    this._hidden = true
    this._layoutRequest = (this._layoutRequest || 0) + 1
  },

  onUnload() {
    this._destroyed = true
    this.onHide()
  },

  checkAuthenticated() {
    if (app.globalData.isLoggedIn && getToken()) return true
    app.openLogin()
    return false
  },

  loadDisclaimer() {
    const request = this._configRequest = (this._configRequest || 0) + 1
    const token = getToken()
    this._layoutRequest = (this._layoutRequest || 0) + 1
    this._scrollHeight = 0
    this.setData({ canAgree: false })
    // 文案与版本号以后端 sys_config 为准，接口不可用时退回本地文案
    return fetchAppConfig(['TEXT'])
      .then((config) => {
        if (this._destroyed || request !== this._configRequest || token !== getToken()) return
        const text = (config && config.TEXT) || {}
        const body = text['text.disclaimer']
        const version = String(text['text.disclaimer.version'] || '').trim()
        if (version) {
          wx.setStorageSync('disclaimerCurrentVersion', version)
          app.globalData.disclaimerCurrentVersion = version
        }
        this._layoutRequest = (this._layoutRequest || 0) + 1
        this._scrollHeight = 0
        this.setData({
          paragraphs: body ? [body].concat(DISCLAIMER_CONTENT.slice(1)) : DISCLAIMER_CONTENT,
          version,
          canAgree: false,
          submitting: false
        }, () => this.measureReadPosition())
      })
      .catch(() => null)
  },

  onScrollToBottom() {
    if (!this._hidden && !this._destroyed && !this.data.canAgree) {
      this.setData({ canAgree: true })
    }
  },

  onDisclaimerScroll(event) {
    if (this._hidden || this._destroyed || this.data.canAgree) return
    const { scrollTop, scrollHeight } = (event && event.detail) || {}
    if (this._scrollHeight > 0 && Number.isFinite(scrollTop) && Number.isFinite(scrollHeight) &&
        scrollTop >= 0 && scrollHeight > 0 &&
        scrollTop + this._scrollHeight >= scrollHeight - BOTTOM_TOLERANCE) {
      this.onScrollToBottom()
    } else if (!this._scrollHeight) {
      this.measureReadPosition()
    }
  },

  measureReadPosition() {
    if (!this._viewReady || this._hidden || this._destroyed || this.data.canAgree ||
        typeof this.createSelectorQuery !== 'function') return
    const request = this._layoutRequest = (this._layoutRequest || 0) + 1
    // 同时测量滚动窗口与正文：短内容、异步文案替换及触底事件漏发时也能正确解锁。
    this.createSelectorQuery().select('.disclaimer-scroll').boundingClientRect()
      .select('.disclaimer-text').boundingClientRect().exec((rects) => {
        if (request !== this._layoutRequest || this._hidden || this._destroyed) return
        const viewport = rects && rects[0], content = rects && rects[1]
        if (!viewport || !content || !(viewport.height > 0) || !(content.height > 0)) return
        this._scrollHeight = viewport.height
        if (Number.isFinite(content.bottom) && Number.isFinite(viewport.bottom) &&
            content.bottom <= viewport.bottom + BOTTOM_TOLERANCE &&
            content.bottom >= viewport.top - BOTTOM_TOLERANCE) this.onScrollToBottom()
      })
  },

  onAgree() {
    if (!this.checkAuthenticated()) return
    if (!this.data.canAgree || this.data.submitting) return
    if (!this.data.version) {
      wx.showToast({ title: '免责声明版本未获取到，请稍后重试', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    const token = getToken()
    return agreeDisclaimer(this.data.version)
      .then(() => {
        if (getToken() !== token || !this.checkAuthenticated()) return
        if (typeof app.markDisclaimerAgreed === 'function') {
          app.markDisclaimerAgreed(this.data.version)
        }
        wx.showToast({ title: '已同意', icon: 'success' })
        setTimeout(() => {
          if (getToken() !== token || !app.globalData.isLoggedIn) return
          if (this.data.forced) {
            wx.switchTab({ url: '/pages/ai/ai' })
          } else {
            wx.navigateBack()
          }
        }, 800)
      })
      .catch((err) => {
        this.setData({ submitting: false })
        if (err && err.code === 40100) {
          app.resetLoginState()
          app.openLogin()
          return
        }
        wx.showToast({ title: err.message || '提交失败', icon: 'none' })
        if (err && err.code === 40001) this.loadDisclaimer()
      })
  }
})
