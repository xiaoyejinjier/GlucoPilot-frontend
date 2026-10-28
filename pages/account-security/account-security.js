const {
  fetchMe, sendSmsCode, bindPhone, sendEmailCode, bindEmail, fetchCancellationStatus
} = require('../../services/api')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { saveUserInfo } = require('../../utils/storage')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Page({
  data: {
    displayStyle: '',
    phone: '未绑定',
    email: '未绑定',
    panel: false,
    newPhone: '',
    smsCode: '',
    smsCooldown: 0,
    emailPanel: false,
    newEmail: '',
    emailCode: '',
    emailCooldown: 0,
    submitting: false,
    // 注销入口副标题：仅注销处理中（accountStatus=4）显示“申请处理中”，详情见独立说明页。
    recoverable: false
  },

  onLoad(options){if(options&&options.bind==='phone')this.onBindPhone()},

  onShow() {
    applyDisplayToCurrentPage()
    this.refresh()
    this.refreshCancellation()
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
    if (this._emailTimer) clearInterval(this._emailTimer)
  },

  refresh() {
    fetchMe()
      .then((me) => {
        saveUserInfo(me)
        const phoneMasked = me.phoneMasked || ''
        const emailMasked = me.emailMasked || ''
        const hasPhone = !!phoneMasked && phoneMasked !== '未绑定'
        const hasEmail = !!emailMasked && emailMasked !== '***' && emailMasked !== '未绑定'
        this.setData({
          phone: hasPhone ? phoneMasked : '未绑定',
          email: hasEmail ? emailMasked : '未绑定'
        })
      })
      .catch((err) => wx.showToast({ title: err.message || '账号信息加载失败', icon: 'none' }))
  },

  /** 注销入口只读状态：申请处理中标记；流程与操作全部在独立说明页完成。 */
  refreshCancellation() {
    return fetchCancellationStatus()
      .then((data) => {
        this.setData({ recoverable: !!(data && data.accountStatus === 4) })
        return data
      })
      .catch(() => null)
  },

  onBindPhone() {
    this.setData({ panel: true, emailPanel: false, newPhone: '', smsCode: '' })
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
  },

  onBindEmail() {
    this.setData({ emailPanel: true, panel: false, newEmail: '', emailCode: '' })
  },

  onCloseEmailPanel() {
    this.setData({ emailPanel: false })
  },

  onEmailInput(e) {
    this.setData({ newEmail: e.detail.value.trim() })
  },

  onEmailCodeInput(e) {
    this.setData({ emailCode: e.detail.value.trim() })
  },

  onSendEmailCode() {
    const email = this.data.newEmail
    if (!EMAIL_RE.test(email)) {
      wx.showToast({ title: '请输入正确邮箱', icon: 'none' })
      return
    }
    if (this.data.emailCooldown > 0) return

    wx.showLoading({ title: '发送中...', mask: true })
    sendEmailCode(email, 'bind')
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

  onConfirmBindEmail() {
    const { newEmail, emailCode } = this.data
    if (!EMAIL_RE.test(newEmail)) {
      wx.showToast({ title: '请输入正确邮箱', icon: 'none' })
      return
    }
    if (!/^\d{6}$/.test(emailCode)) {
      wx.showToast({ title: '请输入 6 位验证码', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    this.setData({ submitting: true })
    bindEmail(newEmail, emailCode)
      .then((res) => {
        this.setData({ submitting: false, emailPanel: false, email: res.emailMasked })
        wx.showToast({ title: '绑定成功', icon: 'success' })
      })
      .catch((err) => {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || '绑定失败', icon: 'none' })
      })
  },

  /** 注销：跳转独立说明页（QQ 风格），说明、验证与确认全部在新页面完成。 */
  onOpenCancel() {
    wx.navigateTo({ url: '/pages/account-cancellation/cancellation' })
  }
})
