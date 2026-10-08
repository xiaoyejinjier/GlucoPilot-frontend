const { login } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getDisplayStyle } = require('../../utils/display')
const { wechatLogin, sendSmsCode, phoneLogin } = require('../../services/api')
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
    if (app.globalData.isLoggedIn) {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
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
  }
})
