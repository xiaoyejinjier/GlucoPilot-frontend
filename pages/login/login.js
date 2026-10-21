const { login } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getDisplayStyle } = require('../../utils/display')
const { wechatLogin, sendSmsCode, phoneLogin, sendEmailCode, emailLogin } = require('../../services/api')
const config = require('../../utils/config')
const app = getApp()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Page({
  data: {
    displayStyle: '',
    phonePanel: false,
    phone: '',
    smsCode: '',
    smsCooldown: 0,
    emailPanel: false,
    email: '',
    emailCode: '',
    emailCooldown: 0
  },

  onLoad() {
    this.setData({ displayStyle: getDisplayStyle() })

  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
    if (this._emailTimer) clearInterval(this._emailTimer)
  },

  checkConnectionSettings() {
    const issue = config.connectionIssue()
    if (!issue) return true
    wx.showToast({ title: issue, icon: 'none', duration: 3500 })
    return false
  },

  finishLogin() {
    login()
    app.globalData.isLoggedIn = true
    // 按已同意的声明版本完成登录后的路由，邮箱登录同样走此流程。
    if (typeof app.goAfterLogin === 'function') return app.goAfterLogin()
    wx.reLaunch({ url: '/pages/disclaimer/disclaimer?forced=1' })
  },

  onWechatLogin() {
    if (!this.checkConnectionSettings()) return
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
            this.finishLogin(data)
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: err.message || '登录失败', icon: 'none' })
          })
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
    this.setData({ phonePanel: true, emailPanel: false })
  },

  onClosePhonePanel() {
    this.setData({ phonePanel: false })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value.trim() })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail.value.trim() })
  },

  onSendSms() {
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
    wx.showLoading({ title: '登录中...', mask: true })
    phoneLogin(phone, smsCode)
      .then((data) => {
        wx.hideLoading()
        this.setData({ phonePanel: false })
        this.finishLogin(data)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '登录失败', icon: 'none' })
      })
  },

  onEmailLogin() {
    this.setData({ emailPanel: true, phonePanel: false })
  },

  onCloseEmailPanel() {
    this.setData({ emailPanel: false })
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value.trim() })
  },

  onEmailCodeInput(e) {
    this.setData({ emailCode: e.detail.value.trim() })
  },

  onSendEmailCode() {
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
    wx.showLoading({ title: '登录中...', mask: true })
    emailLogin(email, emailCode)
      .then((data) => {
        wx.hideLoading()
        this.setData({ emailPanel: false })
        this.finishLogin(data)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '登录失败', icon: 'none' })
      })
  }
})
