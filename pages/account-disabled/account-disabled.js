const config = require('../../utils/config')
const { logoutRemote } = require('../../services/api')
const { clearAccountCache } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const i18n = require('../../utils/i18n')

Page({
  data: {
    locale: i18n.getLocale(),
    displayStyle: '',
    email: '',
    phone: '',
    emailText: '—',
    phoneText: '—'
  },

  onShow() {
    applyDisplayToCurrentPage()
    // 客服联系方式为开发阶段占位值，上线前在 utils/config.js 替换
    const contact = config.supportContact || {}
    const email = contact.email || ''
    const phone = contact.phone || ''
    this.setData({
      locale: i18n.getLocale(),
      email,
      phone,
      emailText: email || '—',
      phoneText: phone || '—'
    })
  },

  /** 单行复制：成功后在屏幕中央提示复制结果。 */
  onCopy(e) {
    const type = e.currentTarget.dataset.type
    const value = type === 'phone' ? this.data.phone : this.data.email
    if (!value) return
    wx.setClipboardData({
      data: value,
      success: () => {
        wx.showToast({
          title: type === 'phone' ? i18n.t('电话复制成功') : i18n.t('邮箱复制成功'),
          icon: 'none'
        })
      }
    })
  },

  /** 关闭：撤销会话、清账号级缓存并回登录页（封禁账号无法使用业务功能）。 */
  onClose() {
    Promise.resolve()
      .then(() => logoutRemote())
      .catch(() => null)
      .then(() => {
        const app = getApp()
        if (app && typeof app.resetLoginState === 'function') app.resetLoginState()
        clearAccountCache()
        wx.reLaunch({ url: '/pages/login/login' })
      })
  }
})
