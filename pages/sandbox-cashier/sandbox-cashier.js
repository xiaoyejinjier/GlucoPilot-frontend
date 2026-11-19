const api = require('../../services/wallet')
const social = require('../../utils/community')
const { expiryTime, isSandboxPageUrl } = require('../../utils/sandbox-payment')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', cashierUrl: '', loading: false, error: '', retryable: false, paid: false },
  onLoad(options) {
    this._orderNo = /^[A-Za-z0-9_-]{1,64}$/.test(options.orderNo || '') ? options.orderNo : ''
  },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this)
    applyDisplayToCurrentPage()
    this.load()
  },
  onHide() {
    social.end(this)
    this.stopPolling()
    this._run = (this._run || 0) + 1
    this.setData({ cashierUrl: '', loading: false })
  },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this) || this.data.loading) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.stopPolling()
    this._checking = false
    this._completionShown = false
    this._returning = false
    this.setData({ loading: true, cashierUrl: '', error: '', retryable: false, paid: false })
    if (!this._orderNo) {
      this.setData({ loading: false, error: '订单不存在' })
      return
    }
    try {
      // 路由只传订单号，按当前登录身份重新获取链接，避免跨账号沿用旧链接。
      const payment = await api.payment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      if (payment.status === 'PAID') {
        this.showCompleted()
        return
      }
      if (payment.status !== 'PENDING') {
        this.setData({ loading: false, error: '订单已关闭，请返回查看订单' })
        return
      }
      const expiresAt = expiryTime(payment.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        this.setData({ loading: false, error: '付款已过期，请返回重新充值' })
        return
      }
      if (payment.paymentMode !== 'PAGE') {
        this.setData({ loading: false, error: '此订单使用旧付款方式，请重新充值生成网页付款订单。' })
        return
      }
      if (!isSandboxPageUrl(payment.pageUrl)) throw new Error('网页付款链接加载失败，请重试')
      this.setData({ loading: false, cashierUrl: payment.pageUrl, retryable: true })
      this._pollDeadline = Math.min(expiresAt + 60000, Date.now() + 16 * 60000)
      this._timer = setInterval(() => {
        if (Date.now() >= this._pollDeadline) {
          this.stopPolling()
          return
        }
        this.refreshStatus()
      }, 5000)
      this.refreshStatus()
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, cashierUrl: '', error: error.message || '网页付款链接加载失败，请重试',
        retryable: error.code !== 40100 && error.code !== 40400 && error.code !== 40900 })
      social.failure(this, error, version)
    }
  },
  stopPolling() {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  },
  async refreshStatus() {
    if (!social.active(this) || !this._orderNo || this._checking || this.data.paid || this._returning) return
    const version = this._communityVersion, run = this._run
    this._checking = true
    try {
      const order = await api.refreshPayment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      if (order.status === 'PAID') {
        this.showCompleted()
      } else if (order.status === 'CLOSED') {
        this.stopPolling()
        this.setData({ cashierUrl: '', loading: false, retryable: false, error: '订单已关闭，请返回查看订单' })
      }
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      if (error.code === 40100 || error.code === 40300 || error.code === 40400) {
        this.stopPolling()
        this.setData({ cashierUrl: '', loading: false, retryable: false, error: error.message || '订单不存在' })
        social.failure(this, error, version)
      }
    } finally {
      if (social.active(this, version) && run === this._run) this._checking = false
    }
  },
  showCompleted() {
    if (!social.active(this) || this._completionShown) return
    this._completionShown = true
    this.stopPolling()
    // 先卸载收银台，确保原生返回按钮和到账结果可见。
    const version = this._communityVersion, run = this._run
    this.setData({ cashierUrl: '', loading: false, retryable: false, paid: true, error: '' }, () => {
      if (!social.active(this, version) || run !== this._run) return
      wx.showModal({
        title: '付款成功',
        content: '沙箱充值已到账，点击返回付款页查看结果。',
        confirmText: '返回',
        showCancel: false,
        success: result => {
          if (result.confirm && social.active(this, version) && run === this._run) this.onReturn()
        }
      })
    })
  },
  onWebLoad() {
    if (this.data.cashierUrl) this.refreshStatus()
  },
  onWebError() {
    if (!social.active(this) || !this.data.cashierUrl) return
    // 不展示原生错误中的完整签名URL；网页打开失败也不能标记为已支付。
    this.setData({ cashierUrl: '', loading: false, retryable: true,
      error: '微信未能打开收银台，可能受到业务域名限制。' })
  },
  onRetry() { return this.load() },
  onReturn() {
    if (!social.active(this) || this._returning) return
    this._returning = true
    this.stopPolling()
    const version = this._communityVersion, run = this._run
    wx.navigateBack({ delta: 1, fail: () => {
      if (social.active(this, version) && run === this._run) wx.redirectTo({
        url: `/pages/sandbox-payment/sandbox-payment?orderNo=${encodeURIComponent(this._orderNo)}`,
        fail: () => {
          if (social.active(this, version) && run === this._run) this._returning = false
        }
      })
    } })
  }
})
