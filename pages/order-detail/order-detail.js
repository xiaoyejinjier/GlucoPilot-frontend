const api = require('../../services/wallet')
const social = require('../../utils/community')
const { decorate } = require('../../utils/wallet')
const { identifier } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', type: 'CONSULTATION', order: null, loading: false, error: '' },
  onLoad(options) {
    this._orderNo = /^[A-Za-z0-9_-]{1,64}$/.test(options.orderNo || '') ? options.orderNo : ''
    if (options.type === 'RECHARGE') this.setData({ type: 'RECHARGE' })
  },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage(); this.load()
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({ order: null, loading: true, error: '' })
    if (!this._orderNo) { this.setData({ loading: false, error: '订单不存在' }); return }
    try {
      const row = await api.detail(this.data.type, this._orderNo)
      if (social.active(this, version) && run === this._run) this.setData({ order: decorate(row), loading: false })
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, error: error.message || '订单加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  onCopy() { if (social.active(this) && this.data.order) wx.setClipboardData({ data: this.data.order.orderNo }) },
  onPay() {
    if (social.active(this) && this.data.type === 'RECHARGE' && this.data.order && this.data.order.status === 'PENDING')
      wx.navigateTo({ url: `/pages/sandbox-payment/sandbox-payment?orderNo=${encodeURIComponent(this.data.order.orderNo)}` })
    else if (social.active(this) && this.data.type === 'CONSULTATION' && this.data.order && this.data.order.status === 'PENDING') {
      const id = identifier(this.data.order.reportId)
      if (id) wx.navigateTo({ url: `/pages/consultation-checkout/consultation-checkout?reportId=${id}` })
    }
  },
  onReport() {
    const id = identifier(this.data.order && this.data.order.consultationId)
    if (social.active(this) && id) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${id}` })
  },
  onRetry() { return this.load() },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } }
})
