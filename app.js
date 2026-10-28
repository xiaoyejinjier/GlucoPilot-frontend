const { applyDisplayToCurrentPage, saveDisplaySettings } = require('./utils/display')
const { getUserInfo, saveUserInfo, clearAccountCache } = require('./utils/storage')
const { getToken, setToken } = require('./utils/request')
const { fetchMe, fetchAppConfig, fetchCancellationStatus, recoverCancellation, logoutRemote } = require('./services/api')
const { fontNameOf, themeIdOf } = require('./utils/mappers')
const config = require('./utils/config')
const messageNotifications = require('./utils/message-notifications')
const i18n = require('./utils/i18n')
if (typeof Page === 'function') Page = i18n.wrapPage(Page)
if (typeof Component === 'function') Component = i18n.wrapComponent(Component)
i18n.install()

/** 服务端时间戳为 epoch 毫秒（Long 序列化成字符串）。 */
function formatCancellationDeadline(value) {
  const ms = Number(value)
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    disclaimerRequired: false,
    disclaimerCurrentVersion: '',
    navigationGuideToken: '',
    unreadCount: 0,
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
    this.logRuntimeConfig()
  },

  /**
   * 启动时把"当前请求打到哪个后端、这个地址是怎么来的"打一条日志。
   * <p>
   * 2026-10-16 的登录事故里，最耗时的一步是"确认小程序到底在往哪个地址发请求"——
   * 后端一条日志都没有，只能靠人肉翻配置。这一行日志 + 请求失败信息里的地址，
   * 就是为了让同类问题在十秒内定位（配置来源同时暴露：storage 覆盖 / devtools 默认 /
   * 开发兜底 / 生产）。
   */
  logRuntimeConfig() {
    try {
      const resolved = typeof config.resolveBaseUrl === 'function'
        ? config.resolveBaseUrl()
        : { url: config.baseUrl, source: 'unknown' }
      console.info('[config] API 地址 = ' + resolved.url + '（来源：' + resolved.source
        + '，envVersion=' + config.envVersion() + '，platform=' + (config.devicePlatform() || 'unknown') + '）')
    } catch (e) {
      console.warn('[config] 运行时配置日志输出失败：' + (e && e.message))
    }
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
    if (!this.globalData.disclaimerRequired) messageNotifications.start()
  },

  onHide() { messageNotifications.stop() },

  resetLoginState() {
    // During onLaunch the instance exists as this, but getApp() may not be ready yet.
    messageNotifications.reset(this)
    setToken('')
    wx.setStorageSync('isLoggedIn', false)
    this.globalData.isLoggedIn = false
    this.globalData.userInfo = null
    this.globalData.disclaimerRequired = false
    this.globalData.disclaimerCurrentVersion = ''
    this.globalData.navigationGuideToken = ''
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

  /** 登录完成后的唯一去向：注销/禁用拦截优先，其次免责声明，否则进入记录页。 */
  goAfterLogin() {
    return this.syncProfile()
      .then((state) => {
        const status = state.userInfo && state.userInfo.accountStatus
        if (status === 4) return this.interceptCancelledLogin()
        if (status === 0) return this.interceptDisabledLogin()
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

  /**
   * 注销可恢复窗口内登录（accountStatus=4）：服务端只放行注销相关接口。
   * 登录即本人身份核验——确认继续就撤销注销并按申请前状态还原（24 小时冷却期内不可再次提交）；
   * 暂不使用则退出登录，7 天期满后由服务端彻底清理。
   */
  interceptCancelledLogin() {
    return fetchCancellationStatus()
      .then((data) => {
        const record = (data && data.cancellation) || {}
        const deadline = formatCancellationDeadline(record.isolateUntil)
        return new Promise((resolve) => {
          wx.showModal({
            title: '账号注销中',
            content: deadline
              ? `账号将于 ${deadline} 注销，届时数据将被永久删除。登录即视为取消注销，是否继续使用账号？`
              : '账号正在注销中，数据将被永久删除。登录即视为取消注销，是否继续使用账号？',
            confirmText: '取消注销',
            cancelText: '暂不使用',
            confirmColor: '#0969da',
            success: (result) => {
              if (result.confirm) {
                this.recoverAfterLogin().then(resolve)
              } else {
                this.exitCancelledLogin().then(resolve)
              }
            },
            fail: () => this.exitCancelledLogin().then(resolve)
          })
        })
      })
      .catch(() => {
        // 状态查询失败（含会话被门禁拦截）时回登录页，不进入主界面。
        this.resetLoginState()
        this.openLogin()
        return null
      })
  },

  /** 确认继续使用：会话由 wx.login/验证码登录建立，身份已核验，直接撤销注销。 */
  recoverAfterLogin() {
    wx.showLoading({ title: '正在撤销注销...', mask: true })
    return recoverCancellation()
      .then((res) => {
        wx.hideLoading()
        const status = res && res.accountStatus
        if (status === 0) {
          // 申请前即为禁用账号：还原后仍禁用，仅可办理注销或退出。
          return new Promise((resolve) => {
            wx.showModal({
              title: '注销已取消',
              content: '账号已恢复，但仍处于禁用状态，仅可办理注销或退出登录。',
              confirmText: '去注销',
              cancelText: '退出登录',
              success: (r) => {
                if (r.confirm) {
                  wx.reLaunch({ url: '/pages/account-cancellation/cancellation' })
                } else {
                  this.exitLoginQuietly()
                }
                resolve(null)
              }
            })
          })
        }
        wx.showToast({ title: '注销已取消，欢迎回来', icon: 'success' })
        if (this.globalData.disclaimerRequired) {
          this.openRequiredDisclaimer()
        } else {
          wx.switchTab({ url: '/pages/ai/ai' })
        }
        return { recovered: true }
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '撤销注销失败，请重试', icon: 'none' })
        this.resetLoginState()
        this.openLogin()
        return null
      })
  },

  /** 暂不使用：撤销远程会话、清账号级缓存并回登录页。 */
  exitCancelledLogin() {
    return Promise.resolve()
      .then(() => logoutRemote())
      .catch(() => null)
      .then(() => {
        this.exitLoginQuietly()
        return { recovered: false }
      })
  },

  /** 退出当前会话：远程撤销已由调用方完成，这里只清本地状态并回登录页。 */
  exitLoginQuietly() {
    this.resetLoginState()
    clearAccountCache()
    wx.reLaunch({ url: '/pages/login/login' })
  },

  /** 禁用账号登录（accountStatus=0）：仅可办理注销或退出。 */
  interceptDisabledLogin() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '账号已被禁用',
        content: '该账号当前处于禁用状态，仅可申请注销账号或退出登录。',
        confirmText: '申请注销',
        cancelText: '退出登录',
        confirmColor: '#fa5151',
        success: (result) => {
          if (result.confirm) {
            wx.reLaunch({ url: '/pages/account-cancellation/cancellation' })
            resolve({ disabled: true })
          } else {
            this.exitCancelledLogin().then(resolve)
          }
        },
        fail: () => this.exitCancelledLogin().then(resolve)
      })
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
    // 只在首次同意成功后引导；声明更新后的重新确认不属于新手流程。
    if (userInfo.disclaimerAgreed === false && this.globalData.isLoggedIn && getToken()) {
      this.globalData.navigationGuideToken = getToken()
    }
    userInfo.disclaimerAgreed = true
    userInfo.disclaimerVersion = version
    saveUserInfo(userInfo)
    wx.setStorageSync('disclaimerAgreed', true)
    wx.setStorageSync('disclaimerCurrentVersion', version)
    this.globalData.userInfo = userInfo
    this.globalData.disclaimerRequired = false
    this.globalData.disclaimerCurrentVersion = version
  },

  getNavigationGuideToken() {
    const token = getToken()
    return this.globalData.isLoggedIn && !this.globalData.disclaimerRequired &&
      token && this.globalData.navigationGuideToken === token ? token : ''
  },

  completeNavigationGuide(token) {
    if (!token || token !== this.getNavigationGuideToken()) return false
    this.globalData.navigationGuideToken = ''
    return true
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
    messageNotifications.start()
    return true
  }
})
