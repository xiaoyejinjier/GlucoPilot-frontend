const { login } = require('../../utils/storage')
const { setToken } = require('../../utils/request')
const { applyDisplayToCurrentPage, getDisplayStyle } = require('../../utils/display')
const { wechatLogin, sendSmsCode, phoneLogin, sendEmailCode, emailLogin,
  confirmCancelRecovery, isRecoverConfirm } = require('../../services/api')
const config = require('../../utils/config')
const accountVault = require('../../utils/account-vault')
const app = getApp()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LAST_LOGIN_PHONE_KEY = 'lastLoginPhone'
const LAST_LOGIN_EMAIL_KEY = 'lastLoginEmail'
const LOGIN_AGREEMENT_KEY = 'loginAgreementAcceptance'
// 登录入口的本机选择单独保存，不替代登录后的账号声明版本校验。
const LOGIN_AGREEMENT_VERSION = 'v1'
const PHONE_RE = /^1\d{10}$/
function reusableEmail(value) {
  return typeof value === 'string' && value.length <= 128 && EMAIL_RE.test(value)
    && !/[*＊…•]/.test(value)
}

Page({
  data: {
    displayStyle: '',
    loginLayoutStyle: '',
    phonePanel: false,
    phone: '',
    lastLoginPhone: '',
    usingLastPhone: false,
    phoneFocus: false,
    smsCode: '',
    smsCooldown: 0,
    emailPanel: false,
    email: '',
    lastLoginEmail: '',
    usingLastEmail: false,
    emailFocus: false,
    emailCode: '',
    emailCooldown: 0,
    hasSavedAccounts: false,
    agreementChecked: false,
    recoverModalVisible: false,
    recoverPayload: null,
    recoverContent: '',
    recoverSubmitting: false
  },

  onLoad() {
    this.restoreAgreementChoice()
    this.setData({ displayStyle: getDisplayStyle() })
    this.updateLoginLayout()
  },

  onShow() {
    this._loginVisible = true
    if (!this._agreementLoaded) this.restoreAgreementChoice()
    this._accountSaveIntent = app.globalData.accountSaveIntent || null
    applyDisplayToCurrentPage()
    this.updateLoginLayout()
    this.setData({ hasSavedAccounts: !!app.globalData.accountSwitchFlow && accountVault.list().length > 0 })
    const pending = app.globalData.pendingLoginPhone
    app.globalData.pendingLoginPhone = ''
    if (typeof pending === 'string' && PHONE_RE.test(pending)) {
      this.setData({ phonePanel: true, emailPanel: false, phone: pending,
        lastLoginPhone: pending, usingLastPhone: true, smsCode: '', phoneFocus: false })
    }
  },

  onSavedAccounts() {
    if (this.data.hasSavedAccounts && app.globalData.accountSwitchFlow)
      wx.navigateTo({ url: '/pages/account-switch/account-switch' })
  },

  onAgreementChange(event) {
    this.saveAgreementChoice((event.detail.value || []).includes('agreed'))
  },

  restoreAgreementChoice() {
    let agreed = false
    try {
      const saved = wx.getStorageSync(LOGIN_AGREEMENT_KEY)
      agreed = !!saved && saved.version === LOGIN_AGREEMENT_VERSION && saved.accepted === true
    } catch (_) { /* 无法读取本地选择时，仍由用户主动同意。 */ }
    this._agreementLoaded = true
    this.setData({ agreementChecked: agreed })
  },

  saveAgreementChoice(accepted) {
    this._agreementLoaded = true
    this.setData({ agreementChecked: accepted })
    try {
      wx.setStorageSync(LOGIN_AGREEMENT_KEY, { version: LOGIN_AGREEMENT_VERSION, accepted })
    } catch (_) { /* 存储失败不妨碍本次主动选择，下次重新确认即可。 */ }
  },

  requireAgreement() {
    if (this.data.agreementChecked) return true
    if (this._agreementPrompt || this._loginVisible === false) return false
    this._agreementPrompt = true
    const epoch = this._agreementEpoch || 0
    wx.showModal({
      title: '请先同意协议',
      content: '请阅读并同意《用户协议》《隐私政策》《免责声明》后继续。',
      confirmText: '同意',
      cancelText: '拒绝',
      showCancel: true,
      confirmColor: '#315b95',
      success: result => {
        if (epoch !== (this._agreementEpoch || 0) || this._loginVisible === false) return
        this._agreementPrompt = false
        if (result.confirm) this.saveAgreementChoice(true)
      },
      fail: () => { if (epoch === (this._agreementEpoch || 0)) this._agreementPrompt = false }
    })
    return false
  },

  onHide() {
    this._loginVisible = false
    this._agreementEpoch = (this._agreementEpoch || 0) + 1
    this._agreementPrompt = false
  },

  onResize() { this.updateLoginLayout() },

  updateLoginLayout() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      const statusBar = Number(info.statusBarHeight) || 0
      const bottom = capsule && Number(capsule.bottom)
      const top = Number.isFinite(bottom) && bottom > statusBar ? bottom + 12 : statusBar + 56
      this.setData({ loginLayoutStyle: `--login-header-space:${top}px` })
    } catch (_) { /* CSS safe-area fallback supports older clients. */ }
  },

  onUnload() {
    this.onHide()
    if (this._smsTimer) clearInterval(this._smsTimer)
    if (this._emailTimer) clearInterval(this._emailTimer)
  },

  checkConnectionSettings() {
    const issue = config.connectionIssue()
    if (!issue) return true
    wx.showToast({ title: issue, icon: 'none', duration: 3500 })
    return false
  },

  finishLogin(data, accountSaveIntent = this._accountSaveIntent || null) {
    if (this._loginVisible === false) return
    if (accountSaveIntent !== (app.globalData.accountSaveIntent || null)) return
    app.globalData.accountSaveIntent = null
    this._accountSaveIntent = null
    app.globalData.accountSwitchFlow = false
    login()
    app.globalData.isLoggedIn = true
    // 按已同意的声明版本完成登录后的路由，邮箱登录同样走此流程。
    if (typeof app.goAfterLogin === 'function') return app.goAfterLogin({ accountSaveIntent })
    wx.reLaunch({ url: '/pages/disclaimer/disclaimer?forced=1' })
  },

  /** 三处登录失败统一入口：冷静期拦截弹二次确认，其余走普通 toast。 */
  handleLoginFailure(err) {
    wx.hideLoading()
    if (this._loginVisible === false) return
    if (isRecoverConfirm(err)) {
      this.openCancelRecoverModal(err.body.data)
      return
    }
    wx.showToast({ title: err.message || '登录失败', icon: 'none' })
  },

  openCancelRecoverModal(payload) {
    const days = Math.max(1, Number(payload.remainingDays) || 1)
    const deadline = payload.cancelDeadlineAt ? this.formatDateTime(payload.cancelDeadlineAt) : ''
    let content = `你的账号正处于注销冷静期（剩余 ${days} 天）`
    if (deadline) content += `，将于 ${deadline} 到期`
    content += '。是否撤销注销并登录？'
    if (payload.willStayDisabled) {
      content += '\n\n该账号此前已被禁用，恢复登录后仍将保持禁用状态。'
    }
    this.setData({
      recoverModalVisible: true,
      recoverPayload: payload,
      recoverContent: content,
      recoverSubmitting: false
    })
  },

  onRecoverConfirm() {
    if (this.data.recoverSubmitting) return
    const payload = this.data.recoverPayload
    if (!payload || !payload.recoverTicket) return this.closeCancelRecoverModal()

    this.setData({ recoverSubmitting: true })
    wx.showLoading({ title: '恢复中...', mask: true })
    confirmCancelRecovery(payload.recoverTicket)
      .then((data) => {
        wx.hideLoading()
        this.setData({ recoverModalVisible: false, recoverPayload: null, recoverSubmitting: false })
        if (data.accountStatus === 0) {
          wx.showToast({ title: '账号已恢复，但当前处于禁用状态', icon: 'none', duration: 3000 })
        }
        this.finishLogin()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ recoverSubmitting: false })
        if (err && (err.code === 40001 || err.code === 40100 || err.code === 40900 || err.code === 40901)) {
          // 票据过期 / 已过反悔期 / 状态已被改变：确认已无意义，关闭并要求重新登录。
          this.closeCancelRecoverModal()
          wx.showToast({ title: err.message || '恢复确认已失效，请重新登录', icon: 'none' })
          return
        }
        wx.showToast({ title: err.message || '恢复失败，请重试', icon: 'none' })
      })
  },

  onRecoverAbandon() {
    if (this.data.recoverSubmitting) return
    this.setData({ recoverModalVisible: false, recoverPayload: null })
    // 后端不调用任何接口，账号状态保持"注销中"。
    this.clearLocalSession()
    if (typeof wx.exitMiniProgram === 'function') {
      wx.exitMiniProgram({ fail: () => wx.reLaunch({ url: '/pages/login/login' }) })
    } else {
      wx.reLaunch({ url: '/pages/login/login' })
    }
  },

  clearLocalSession() {
    try {
      setToken('')
      wx.setStorageSync('isLoggedIn', false)
    } catch (_) { /* 本地缓存不可用时忽略 */ }
    app.globalData.isLoggedIn = false
  },

  closeCancelRecoverModal() {
    this.setData({ recoverModalVisible: false, recoverPayload: null, recoverSubmitting: false })
  },

  onRecoverMaskTap() { /* 遮罩不可关闭：必须二选一。 */ },

  formatDateTime(timestamp) {
    const date = new Date(Number(timestamp))
    if (Number.isNaN(date.getTime())) return ''
    const pad = n => (n < 10 ? `0${n}` : `${n}`)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  noop() {},

  onWechatLogin() {
    if (!this.requireAgreement()) return
    if (!this.checkConnectionSettings()) return
    const saveIntent = this._accountSaveIntent || null
    wx.showLoading({ title: '登录中...', mask: true })
    wx.login({
      timeout: 10000,
      success: (res) => {
        if (!res.code) {
          wx.hideLoading()
          wx.showToast({ title: '获取微信 code 失败', icon: 'none' })
          return
        }
        wechatLogin(res.code)
          .then((data) => {
            wx.hideLoading()
            this.finishLogin(data, saveIntent)
          })
          .catch((err) => this.handleLoginFailure(err))
      },
      fail: (err) => {
        wx.hideLoading()
        const message = String(err && err.errMsg || '')
        const proxyFailure = /tunneling socket|proxy|ECONNREFUSED|ERR_TUNNEL/i.test(message)
        wx.showToast({ title: proxyFailure ? '请在开发者工具的代理设置中选择“不使用任何代理”，再重试登录' : '获取微信登录凭证失败，请重试', icon: 'none', duration: proxyFailure ? 5000 : 2000 })
      }
    })
  },

  onPhoneLogin() {
    if (!this.requireAgreement()) return
    if (this.data.phonePanel) return
    let lastLoginPhone = ''
    try {
      const saved = wx.getStorageSync(LAST_LOGIN_PHONE_KEY)
      // 兼容此前登录过的账号；脱敏号码不能用于发送验证码。
      const previous = typeof saved === 'string' && PHONE_RE.test(saved) ? null : wx.getStorageSync('userInfo')
      const candidate = previous ? previous.phone : saved
      if (typeof candidate === 'string' && PHONE_RE.test(candidate)) lastLoginPhone = candidate
    } catch (_) { /* 本地缓存不可用时仍可手动输入。 */ }
    this.setData({ phonePanel: true, emailPanel: false, lastLoginPhone,
      phone: lastLoginPhone || this.data.phone, usingLastPhone: !!lastLoginPhone,
      smsCode: '', phoneFocus: false })
  },

  onClosePhonePanel() {
    this.setData({ phonePanel: false })
  },

  onPhoneInput(e) {
    const phone = e.detail.value.trim()
    this.setData({ phone, usingLastPhone: !!this.data.lastLoginPhone && phone === this.data.lastLoginPhone,
      ...(phone !== this.data.phone ? { smsCode: '' } : {}) })
  },

  onSwitchPhone() {
    if (!this.data.lastLoginPhone) return
    const useLast = !this.data.usingLastPhone
    this.setData({ phone: useLast ? this.data.lastLoginPhone : '', usingLastPhone: useLast,
      smsCode: '', phoneFocus: !useLast })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail.value.trim() })
  },

  onSendSms() {
    if (!this.requireAgreement()) return
    if (!this.checkConnectionSettings()) return
    const phone = this.data.phone
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (this.data.smsCooldown > 0) return

    wx.showLoading({ title: '发送中...', mask: true })
    sendSmsCode(phone, 'login')
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '验证码已发送(见后端日志)', icon: 'none' })
        this.setData({ smsCooldown: 60 })
        if (this._smsTimer) clearInterval(this._smsTimer)
        this._smsTimer = setInterval(() => {
          const next = this.data.smsCooldown - 1
          if (next <= 0) {
            clearInterval(this._smsTimer)
            this.setData({ smsCooldown: 0 })
          } else {
            this.setData({ smsCooldown: next })
          }
        }, 1000)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '发送失败', icon: 'none' })
      })
  },

  onConfirmPhoneLogin() {
    if (!this.requireAgreement()) return
    if (!this.checkConnectionSettings()) return
    const { phone, smsCode } = this.data
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (!smsCode) {
      wx.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    const saveIntent = this._accountSaveIntent || null
    wx.showLoading({ title: '登录中...', mask: true })
    phoneLogin(phone, smsCode)
      .then((data) => {
        wx.hideLoading()
        // 仅成功登录后记住本设备上次号码，不缓存验证码或自动发送短信。
        try { wx.setStorageSync(LAST_LOGIN_PHONE_KEY, phone) } catch (_) {}
        this.setData({ phonePanel: false, lastLoginPhone: phone, smsCode: '' })
        this.finishLogin(data, saveIntent)
      })
      .catch((err) => this.handleLoginFailure(err))
  },

  onEmailLogin() {
    if (!this.requireAgreement()) return
    if (this.data.emailPanel) return
    let lastLoginEmail = ''
    try {
      const saved = wx.getStorageSync(LAST_LOGIN_EMAIL_KEY)
      const previous = reusableEmail(saved) ? null : wx.getStorageSync('userInfo')
      const candidate = previous ? previous.email : saved
      if (reusableEmail(candidate)) lastLoginEmail = candidate
    } catch (_) { /* 缓存不可用时仍可手动输入邮箱。 */ }
    this.setData({ emailPanel: true, phonePanel: false, lastLoginEmail,
      email: lastLoginEmail || this.data.email, usingLastEmail: !!lastLoginEmail,
      emailCode: '', emailFocus: false })
  },

  onCloseEmailPanel() {
    this.setData({ emailPanel: false })
  },

  onEmailInput(e) {
    const email = e.detail.value.trim()
    this.setData({ email, usingLastEmail: !!this.data.lastLoginEmail && email === this.data.lastLoginEmail,
      ...(email !== this.data.email ? { emailCode: '' } : {}) })
  },

  onSwitchEmail() {
    if (!this.data.lastLoginEmail) return
    const useLast = !this.data.usingLastEmail
    this.setData({ email: useLast ? this.data.lastLoginEmail : '', usingLastEmail: useLast,
      emailCode: '', emailFocus: !useLast })
  },

  onEmailCodeInput(e) {
    this.setData({ emailCode: e.detail.value.trim() })
  },

  onSendEmailCode() {
    if (!this.requireAgreement()) return
    if (!this.checkConnectionSettings()) return
    const email = this.data.email
    if (!EMAIL_RE.test(email)) {
      wx.showToast({ title: '请输入正确邮箱', icon: 'none' })
      return
    }
    if (this.data.emailCooldown > 0) return

    wx.showLoading({ title: '发送中...', mask: true })
    sendEmailCode(email, 'login')
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '验证码已发送至邮箱', icon: 'none' })
        this.setData({ emailCooldown: 60 })
        if (this._emailTimer) clearInterval(this._emailTimer)
        this._emailTimer = setInterval(() => {
          const next = this.data.emailCooldown - 1
          if (next <= 0) {
            clearInterval(this._emailTimer)
            this.setData({ emailCooldown: 0 })
          } else {
            this.setData({ emailCooldown: next })
          }
        }, 1000)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '发送失败', icon: 'none' })
      })
  },

  onConfirmEmailLogin() {
    if (!this.requireAgreement()) return
    if (!this.checkConnectionSettings()) return
    const { email, emailCode } = this.data
    if (!EMAIL_RE.test(email)) {
      wx.showToast({ title: '请输入正确邮箱', icon: 'none' })
      return
    }
    if (!/^\d{6}$/.test(emailCode)) {
      wx.showToast({ title: '请输入 6 位验证码', icon: 'none' })
      return
    }
    const saveIntent = this._accountSaveIntent || null
    wx.showLoading({ title: '登录中...', mask: true })
    emailLogin(email, emailCode)
      .then((data) => {
        wx.hideLoading()
        if (this._loginVisible === false || saveIntent !== (app.globalData.accountSaveIntent || null)) return
        // 只记录成功登录的邮箱，不保存验证码，也不自动发送下一次验证码。
        try { wx.setStorageSync(LAST_LOGIN_EMAIL_KEY, email) } catch (_) {}
        this.setData({ emailPanel: false, lastLoginEmail: email, emailCode: '' })
        this.finishLogin(data, saveIntent)
      })
      .catch((err) => this.handleLoginFailure(err))
  }
})
