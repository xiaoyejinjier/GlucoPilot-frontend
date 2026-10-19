const { login } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getDisplayStyle } = require('../../utils/display')
const { wechatLogin, sendSmsCode, phoneLogin, sendEmailCode, emailLogin } = require('../../services/api')
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
    if (app.globalData.isLoggedIn) {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
    if (this._emailTimer) clearInterval(this._emailTimer)
  },

  finishLogin(session) {
    login()
    app.globalData.isLoggedIn = true
    // 资料与偏好由 app.syncProfile 从 /users/me 拉取后回填
    if (typeof app.syncProfile === 'function') {
      app.syncProfile()
    }
    wx.switchTab({ url: '/pages/index/index' })
  },

  onWechatLogin() {
    wx.showLoading({ title: '登录中...', mask: true })
    wx.login({
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
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: 'wx.login 失败', icon: 'none' })
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
