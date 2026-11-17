const api = require('../../services/consultation')
const wallet = require('../../services/wallet')
const social = require('../../utils/community')
const { identifier, money } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', price: '1.00', doctorName: '', previewMode: true,
    capabilities: api.PREVIEW_CAPABILITIES, loading: false, creating: false,
    error: '', orderNo: '', balance: '—', activated: false, ready: false },
  onLoad(options) { this._reportId = identifier(options.reportId) },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this); applyDisplayToCurrentPage()
    if (previous !== this._communityToken) this._attempt = null
    this.load()
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({ loading: true, creating: false, error: '', orderNo: '', doctorName: '',
      previewMode: true, ready: false, balance: '—', activated: false })
    try {
      const capabilities = await api.capabilities()
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ capabilities, price: money(capabilities.feeCents) })
      if (!this._reportId) return
      const report = await api.report(this._reportId)
      if (!social.active(this, version) || run !== this._run) return
      this._report = report
      if (report.access === 'UNLOCKED') { this.openReport(); return }
      this.setData({ price: money(report.feeCents), doctorName: report.doctorName || '',
        previewMode: false, ready: !!report.ready })
      const summary = await wallet.summary()
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ balance: money(summary.balanceCents), activated: summary.activated === true })
    } catch (error) {
      if (social.active(this, version) && run === this._run) {
        this.setData({ error: error.message || '订单服务暂不可用' }); social.failure(this, error, version)
      }
    } finally { if (social.active(this, version) && run === this._run) this.setData({ loading: false }) }
  },
  onPay() {
    if (!social.active(this) || this.data.creating || this.data.loading) return
    if (this.data.previewMode || !this.data.capabilities.paymentEnabled) {
      wx.showModal({ title: '支付服务待开放', content: '当前为页面预览，未创建订单或扣款。', showCancel: false }); return
    }
    if (!this.data.ready || this.data.error) return
    if (!this.data.activated) { this.onWallet(); return }
    const version = this._communityVersion
    wx.showModal({ title: '确认支付1元', content: '使用沙箱钱包余额支付，费用转入出单医生的沙箱钱包。',
      success: result => { if (result.confirm && social.active(this, version)) this.pay() } })
  },
  async pay() {
    if (!social.active(this) || this.data.creating || !this.data.ready || !this.data.activated) return
    const version = this._communityVersion
    if (!this._attempt) this._attempt = { reportId: this._reportId, clientRequestId: social.requestId() }
    this.setData({ creating: true })
    try {
      const order = await api.createOrder(this._attempt)
      if (!social.active(this, version)) return
      this.setData({ orderNo: order.orderNo })
      const paid = await api.startPayment(order.orderNo, {
        provider: 'WALLET_SANDBOX', clientRequestId: this._attempt.clientRequestId
      })
      if (!social.active(this, version)) return
      if (paid.status !== 'PAID') throw new Error('付款尚未完成，请重试')
      // 阅读权限仍以服务端再次查询的结果为准，客户端不自行解锁。
      const report = await api.report(this._reportId)
      if (!social.active(this, version)) return
      if (report.access !== 'UNLOCKED') throw new Error('付款状态确认中，请重试')
      this._report = report
      wx.showToast({ title: '支付成功', icon: 'success' }); this.openReport()
    } catch (error) { if (social.active(this, version)) social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ creating: false }) }
  },
  openReport() {
    const id = identifier(this._report && this._report.consultationId)
    if (id) wx.redirectTo({ url: `/pages/consultation-detail/consultation-detail?id=${id}` })
  },
  onWallet() { wx.navigateTo({ url: '/pages/wallet/wallet' }) },
  onRecords() { wx.navigateTo({ url: '/pages/consultation-records/consultation-records?tab=orders' }) },
  onRetry() { return this.load() }
})
