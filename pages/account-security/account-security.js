const { fetchMe, sendSmsCode, bindPhone } = require('../../services/api')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { saveUserInfo } = require('../../utils/storage')

Page({
  data: {
    displayStyle: '',
    phone: '未绑定',
    panel: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,
    submitting: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.refresh()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
  },

  refresh() {
    fetchMe()
      .then((me) => {
        saveUserInfo(me)
        this.setData({ phone: me.phoneMasked || '未绑定' })
      })
      .catch((err) => wx.showToast({ title: err.message || '账号信息加载失败', icon: 'none' }))
  },

  onBindPhone() {
    this.setData({ panel: true, newPhone: '', smsCode: '' })
  },

  onClosePanel() {
    this.setData({ panel: false })
  },

  onPhoneInput(e) {
    this.setData({ newPhone: e.detail.value.trim() })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail.value.trim() })
  },

  onSendSms() {
    const phone = this.data.newPhone
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (this.data.smsCooldown > 0) return

    wx.showLoading({ title: '发送中...', mask: true })
    sendSmsCode(phone, 'bind')
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

  onConfirmBind() {
    const { newPhone, smsCode } = this.data
    if (!/^1\d{10}$/.test(newPhone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (!/^\d{6}$/.test(smsCode)) {
      wx.showToast({ title: '请输入 6 位验证码', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    this.setData({ submitting: true })
    bindPhone(newPhone, smsCode)
      .then((res) => {
        this.setData({ submitting: false, panel: false, phone: res.phoneMasked })
        wx.showToast({ title: '绑定成功', icon: 'success' })
      })
      .catch((err) => {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || '绑定失败', icon: 'none' })
      })
  }
})
