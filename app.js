const { applyDisplayToCurrentPage, saveDisplaySettings } = require('./utils/display')
const { getUserInfo, saveUserInfo } = require('./utils/storage')
const { getToken, setToken } = require('./utils/request')
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
    // 冷启动由用户选择登录方式，不用上次调试留下的缓存直接跳过登录页。
    this.resetLoginState()
  },

  onShow(options) {
    applyDisplayToCurrentPage()
    const pages = getCurrentPages()
    const current = pages.length ? pages[pages.length - 1].route : (options && options.path) || ''
    if (!this.globalData.isLoggedIn || !getToken()) {
      if (current && current !== 'pages/login/login') this.openLogin()
      return
    }
    // 登录方式选择页不受后台恢复时的声明检查抢占。
    if (current !== 'pages/login/login') this.enforceDisclaimer()
  },

  resetLoginState() {
    setToken('')
    wx.setStorageSync('isLoggedIn', false)
    this.globalData.isLoggedIn = false
    this.globalData.userInfo = null
    this.globalData.disclaimerRequired = false
    this.globalData.disclaimerCurrentVersion = ''
  },

  openLogin() {
    const pages = getCurrentPages()
    const current = pages.length ? pages[pages.length - 1].route : ''
    if (current === 'pages/login/login' || this._routingLogin) return
    this._routingLogin = true
    wx.reLaunch({
      url: '/pages/login/login',
      complete: () => { this._routingLogin = false }
    })
  },

  /** 登录态下同步资料，并比较用户已同意版本与当前免责声明版本。 */
  syncProfile() {
    const token = getToken()
    if (!this.globalData.isLoggedIn || !token) {
      return Promise.reject(Object.assign(new Error('请先登录'), { code: 40100 }))
    }
    if (this._profilePromise) return this._profilePromise

    const task = Promise.all([
      fetchMe(),
      fetchAppConfig(['TEXT']).catch(() => null)
    ]).then(([userInfo, appConfig]) => {
      if (!this.globalData.isLoggedIn || getToken() !== token) {
        throw Object.assign(new Error('登录状态已变化，请重新登录'), { code: 40100 })
      }
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
      .catch((error) => {
        if ((error && error.code === 40100) || !getToken()) {
          this.resetLoginState()
          this.openLogin()
        }
        return null
      })
  },

  /** 登录完成后的唯一去向：需要确认则去免责声明，否则进入记录页。 */
  goAfterLogin() {
    return this.syncProfile()
      .then((state) => {
        if (state.needsDisclaimer) {
          this.openRequiredDisclaimer()
        } else {
          wx.switchTab({ url: '/pages/ai/ai' })
        }
        return state
      })
      .catch((error) => {
        // 无有效身份或资料校验失败时留在登录流程，不能当成“尚未同意”。
        this.resetLoginState()
        this.openLogin()
        wx.showToast({ title: (error && error.code === 40100) ? '登录已失效，请重新登录' : '资料获取失败，请重试登录', icon: 'none' })
        return null
      })
  },

  openRequiredDisclaimer() {
    if (!this.globalData.isLoggedIn || !getToken()) {
      this.openLogin()
      return
    }
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
      this.openLogin()
      return false
    }
    if (this.globalData.disclaimerRequired) {
      this.openRequiredDisclaimer()
      return false
    }
    return true
  }
})
