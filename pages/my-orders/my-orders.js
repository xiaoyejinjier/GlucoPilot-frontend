const api = require('../../services/wallet')
const social = require('../../utils/community')
const { decorate, STATUSES } = require('../../utils/wallet')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', type: 'CONSULTATION', statuses: STATUSES, status: '', records: [], pageNum: 0, hasMore: false, loading: false, error: '' },
  onLoad(options) { if (options.type === 'RECHARGE') this.setData({ type: 'RECHARGE' }) },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage(); this.load(true)
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load(reset = true) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1
    const params = { pageNum, pageSize: 10 }
    if (this.data.status) params.status = this.data.status
    this.setData({ loading: true, error: '', ...(reset ? { records: [], hasMore: false, pageNum: 0 } : {}) })
    try {
      const page = await api.orders(this.data.type, params)
      if (!social.active(this, version) || run !== this._run) return
      const rows = (page.records || []).map(decorate)
      this.setData({ records: reset ? rows : this.data.records.concat(rows), pageNum,
        hasMore: pageNum < Number(page.pages), loading: false })
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, error: error.message || '订单加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  onType(event) {
    const type = event.currentTarget.dataset.type
    if (!['CONSULTATION', 'RECHARGE'].includes(type) || type === this.data.type) return
    this.setData({ type, status: '' }); this.load(true)
  },
  onStatus(event) {
    const status = event.currentTarget.dataset.status
    if (!STATUSES.some(item => item.code === status) || status === this.data.status) return
    this.setData({ status }); this.load(true)
  },
  onOpen(event) {
    const orderNo = String(event.currentTarget.dataset.order || '')
    if (!this.data.records.some(item => item.orderNo === orderNo)) return
    wx.navigateTo({ url: `/pages/order-detail/order-detail?type=${this.data.type}&orderNo=${encodeURIComponent(orderNo)}` })
  },
  onRetry() { return this.load(true) },
  onReachBottom() { return this.load(false) },
  async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } }
})
