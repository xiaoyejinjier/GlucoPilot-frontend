const { login } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getDisplayStyle } = require('../../utils/display')
const { wechatLogin, sendSmsCode, phoneLogin } = require('../../services/api')
const config = require('../../utils/config')
const app = getApp()

Page({
  data: {
    displayStyle: '',
    phonePanel: false,
    phone: '',
    smsCode: '',
    smsCooldown: 0
  },

  onLoad() {
    this.setData({ displayStyle: getDisplayStyle() })
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
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
    // 资料、当前声明版本与用户已同意版本校验完成后再决定去向。
    if (typeof app.goAfterLogin === 'function') {
      return app.goAfterLogin()
    }
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
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: 'wx.login 失败', icon: 'none' })
      }
    })
  },

  onPhoneLogin() {
    this.setData({ phonePanel: true })
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
  }
})
