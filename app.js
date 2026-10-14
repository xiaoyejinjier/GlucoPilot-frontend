const { applyDisplayToCurrentPage, saveDisplaySettings } = require('./utils/display')
const { getUserInfo, saveUserInfo } = require('./utils/storage')
const { getToken } = require('./utils/request')
const { fetchMe, fetchAppConfig } = require('./services/api')
const { fontNameOf, themeIdOf } = require('./utils/mappers')
const config = require('./utils/config')

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    disclaimerRequired: false,
    disclaimerCurrentVersion: '',
    /** 只读调试信息：真机当前实际请求的 API 地址。 */
    apiBaseUrl: config.baseUrl,
    /** 拍照页传给确认页的临时图，避免 URL 传路径导致黑屏 */
    pendingShotImage: '',
    /** 本次血糖仪拍照的 OCR 结果，只在确认入库流程中短暂使用。 */
    pendingGlucoseOcr: null
  },

  onLaunch() {
    const loggedIn = wx.getStorageSync('isLoggedIn')
    const token = getToken()
    if (loggedIn && token) {
      this.globalData.isLoggedIn = true
      this.globalData.userInfo = getUserInfo()
    } else {
      wx.setStorageSync('isLoggedIn', false)
      this.globalData.isLoggedIn = false
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
    if (this.globalData.isLoggedIn && getToken()) {
      this.enforceDisclaimer()
    }
  },

  /** 登录态下同步资料，并比较用户已同意版本与当前免责声明版本。 */
  syncProfile() {
    if (this._profilePromise) return this._profilePromise

    const task = Promise.all([
      fetchMe(),
      fetchAppConfig(['TEXT']).catch(() => null)
    ]).then(([userInfo, appConfig]) => {
      const text = (appConfig && appConfig.TEXT) || {}
      const remoteVersion = String(text['text.disclaimer.version'] || '').trim()
      const currentVersion = remoteVersion || wx.getStorageSync('disclaimerCurrentVersion') || ''
      if (remoteVersion) wx.setStorageSync('disclaimerCurrentVersion', remoteVersion)

      saveUserInfo(userInfo)
      this.globalData.userInfo = userInfo
      this.globalData.disclaimerCurrentVersion = currentVersion
      this.globalData.disclaimerRequired = !userInfo.disclaimerAgreed ||
        (!!currentVersion && userInfo.disclaimerVersion !== currentVersion)
      saveDisplaySettings({
        fontSize: fontNameOf(userInfo.fontSize),
        theme: themeIdOf(userInfo.themeCode)
      })
      applyDisplayToCurrentPage()
      return {
        userInfo,
        currentVersion,
        needsDisclaimer: this.globalData.disclaimerRequired
      }
    })

    this._profilePromise = task
    task.then(
      () => { if (this._profilePromise === task) this._profilePromise = null },
      () => { if (this._profilePromise === task) this._profilePromise = null }
    )
    return task
  },

  /** 未同意或版本已更新时强制进入免责声明页。 */
  enforceDisclaimer() {
    return this.syncProfile()
      .then((state) => {
        if (state.needsDisclaimer) this.openRequiredDisclaimer()
        return state
      })
      .catch(() => null)
  },

  /** 登录完成后的唯一去向：需要确认则去免责声明，否则进入首页。 */
  goAfterLogin() {
    return this.syncProfile()
      .then((state) => {
        if (state.needsDisclaimer) {
          this.openRequiredDisclaimer()
        } else {
          wx.switchTab({ url: '/pages/index/index' })
        }
        return state
      })
      .catch(() => {
        // 登录已经成功但资料暂时取不到时仍先展示声明，避免未经确认进入业务页。
        this.globalData.disclaimerRequired = true
        this.openRequiredDisclaimer()
        return null
      })
  },

  openRequiredDisclaimer() {
    const pages = getCurrentPages()
    const current = pages.length ? pages[pages.length - 1].route : ''
    if (current === 'pages/disclaimer/disclaimer' || this._routingDisclaimer) return
    this._routingDisclaimer = true
    wx.reLaunch({
      url: '/pages/disclaimer/disclaimer?forced=1',
      complete: () => { this._routingDisclaimer = false }
    })
  },

  markDisclaimerAgreed(version) {
    const userInfo = { ...(this.globalData.userInfo || getUserInfo() || {}) }
    userInfo.disclaimerAgreed = true
    userInfo.disclaimerVersion = version
    saveUserInfo(userInfo)
    wx.setStorageSync('disclaimerAgreed', true)
    wx.setStorageSync('disclaimerCurrentVersion', version)
    this.globalData.userInfo = userInfo
    this.globalData.disclaimerRequired = false
    this.globalData.disclaimerCurrentVersion = version
  },

  checkLogin() {
    if (!this.globalData.isLoggedIn || !getToken()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    if (this.globalData.disclaimerRequired) {
      this.openRequiredDisclaimer()
      return false
    }
    return true
  }
})
