const api = require('../../services/wallet')
const social = require('../../utils/community')
const { money } = require('../../utils/consultation')
const { qrSource, expiryTime } = require('../../utils/sandbox-payment')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', loading: false, checking: false, paid: false, closed: false, qrPath: '',
    orderNo: '', price: '—', expires: '', error: '', paused: false, expired: false, qrGeneration: 0 },
  onLoad(options) { this._orderNo = /^[A-Za-z0-9_-]{1,64}$/.test(options.orderNo || '') ? options.orderNo : '' },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage(); this._polls = 0
    this.setData({ orderNo: this._orderNo, qrPath: '', paid: false, closed: false, error: '', paused: false, price: '—', checking: false, expired: false })
    this.load()
  },
  stopPolling() { if (this._timer) clearInterval(this._timer); this._timer = null },
  stopExpiry() {
    if (this._expiryTimer) clearTimeout(this._expiryTimer)
    this._expiryTimer = null
  },
  markExpired() {
    this.stopPolling()
    this.stopExpiry()
    this.setData({ expired: true, qrPath: '', paused: false, loading: false,
      error: '支付码已过期，请查询付款结果或重新充值' })
  },
  onHide() {
    social.end(this); this.stopPolling(); this.stopExpiry()
    this.setData({ qrPath: '' })
    this._run = (this._run || 0) + 1
  },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.stopPolling(); this.stopExpiry()
    this._polls = 0
    this.setData({ loading: true, qrPath: '', error: '', checking: false, expired: false, paused: false })
    if (!this._orderNo) { this.setData({ loading: false, error: '订单不存在' }); return }
    try {
      const payment = await api.payment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ price: money(payment.amountCents), paid: payment.status === 'PAID', closed: payment.status === 'CLOSED', expires: social.timeLabel(payment.expiresAt) })
      if (payment.status === 'PENDING') {
        const remaining = expiryTime(payment.expiresAt) - Date.now()
        if (!Number.isFinite(remaining)) throw new Error('支付码有效期异常，请重试')
        if (remaining <= 0) {
          this.setData({ loading: false })
          this.markExpired()
          this.refresh(true)
          return
        }
        if (!payment.pngBase64) throw new Error('支付码加载失败，请重试')
        this._expiryTimer = setTimeout(() => {
          if (!social.active(this, version) || run !== this._run) return
          this.markExpired()
          this.refresh(true)
        }, remaining)
        this.setData({ qrPath: qrSource(payment.pngBase64), qrGeneration: run })
      }
      this.setData({ loading: false })
      if (payment.status === 'PENDING') {
        this._timer = setInterval(() => {
          if (!social.active(this, version)) return
          if (++this._polls >= 36) { this.stopPolling(); this.setData({ paused: true }); return }
          this.refresh(true)
        }, 5000)
        this.refresh(true)
      }
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false })
      if (error.code === 40900 && (error.message || '').includes('支付码已过期')) {
        this.markExpired()
        this.refresh(true)
        return
      }
      this.stopExpiry()
      this.setData({ error: error.message || '支付码加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  async refresh(quiet = false) {
    if (!social.active(this) || !this._orderNo || this.data.checking) return
    const version = this._communityVersion, run = this._run
    this.setData({ checking: true })
    try {
      const order = await api.refreshPayment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      const paid = order.status === 'PAID', closed = order.status === 'CLOSED'
      this.setData({ paid, closed, price: money(order.amountCents), checking: false,
        ...(paid || closed ? { qrPath: '', error: '', expired: false } : {}) })
      if (paid || closed) { this.stopPolling(); this.stopExpiry() }
      if (!quiet && !paid && !closed) wx.showToast({ title: '暂未确认付款，请稍后再查', icon: 'none' })
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ checking: false })
      if (!quiet || error.code === 40100) social.failure(this, error, version)
    }
  },
  onRefresh() { return this.refresh(false) },
  onRetry() { return this.load() },
  onQrError(event) {
    if (!social.active(this) || !this.data.qrPath
        || Number(event.currentTarget.dataset.generation) !== this._run) return
    this.setData({ qrPath: '', error: '支付码图片加载失败，请重试' })
  },
  onRecharge() {
    if (social.active(this) && !this.data.checking && !this.data.paid)
      wx.redirectTo({ url: '/pages/wallet/wallet' })
  },
  onDetails() { if (social.active(this)) wx.redirectTo({ url: `/pages/order-detail/order-detail?type=RECHARGE&orderNo=${encodeURIComponent(this._orderNo)}` }) }
})
