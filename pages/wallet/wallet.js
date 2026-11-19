const api = require('../../services/wallet')
const social = require('../../utils/community')
const { amountCents } = require('../../utils/wallet')
const { money } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', loading: false, error: '', ready: false, activated: false, activating: false,
    balance: '—', rechargeEnabled: false, creating: false, withdrawalEligible:false,
    amounts: [1, 5, 10, 20, 50, 100], selected: 10, custom: '', useCustom: false },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this); applyDisplayToCurrentPage()
    if (previous !== this._communityToken) this._attempt = null
    this.setData({ selected: 10, custom: '', useCustom: false })
    this.load()
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({ loading: true, error: '', ready: false, activated: false, activating: false, balance: '—', rechargeEnabled: false, creating: false, withdrawalEligible:false })
    try {
      const summary = await api.summary()
      if (social.active(this, version) && run === this._run) {
        this.applySummary(summary)
        if(typeof api.withdrawalSummary==='function')api.withdrawalSummary().then(value=>{if(social.active(this,version)&&run===this._run)this.setData({withdrawalEligible:value.eligible===true})}).catch(()=>{})
      }
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, error: error.message || '钱包加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  applySummary(summary) {
    this.setData({ loading: false, ready: true, activated: summary.activated === true,
      balance: summary.balanceCents == null ? '—' : money(summary.balanceCents),
      rechargeEnabled: summary.sandbox === true && summary.rechargeEnabled === true })
  },
  onActivate() {
    if (!social.active(this) || !this.data.ready || this.data.activated || this.data.activating) return
    const version = this._communityVersion
    wx.showModal({ title: '开通我的钱包', content: '开通免费，不会充值或扣款。开通后可用于沙箱充值、问诊支付和接收问诊收入。', confirmText: '确认开通',
      success: result => { if (result.confirm && social.active(this, version)) this.activateWallet() } })
  },
  async activateWallet() {
    if (!social.active(this) || this.data.activated || this.data.activating || !this.data.ready) return
    const version = this._communityVersion
    this.setData({ activating: true })
    try {
      const summary = await api.activate()
      if (!social.active(this, version)) return
      this.applySummary(summary); this.setData({ activating: false })
      if (summary.activated) wx.showToast({ title: '钱包已开通', icon: 'success' })
    } catch (error) {
      if (!social.active(this, version)) return
      this.setData({ activating: false }); social.failure(this, error, version)
    }
  },
  onAmount(event) {
    const value = Number(event.currentTarget.dataset.amount)
    if (this.data.amounts.includes(value)) this.setData({ selected: value, custom: '', useCustom: false })
  },
  onCustom(event) { this.setData({ custom: event.detail.value, useCustom: true, selected: 0 }) },
  onRecharge() {
    if (!social.active(this) || !this.data.ready || this.data.loading || !this.data.activated) return
    const value = this.data.useCustom ? this.data.custom : this.data.selected
    if (amountCents(value) == null) {
      wx.showToast({ title: '请输入1～1000元，最多两位小数', icon: 'none' }); return
    }
    if (!this.data.rechargeEnabled) {
      wx.showModal({ title: '支付宝沙箱尚未配置', content: '请先完成后端沙箱应用配置。本次未创建订单或扣款。', showCancel: false }); return
    }
    if (this.data.creating) return
    const version = this._communityVersion
    wx.showModal({ title: '确认沙箱充值', content: '仅使用支付宝沙箱测试资金，不会充值真实钱包。',
      success: result => { if (result.confirm && social.active(this, version)) this.createRecharge() } })
  },
  async createRecharge() {
    if (!social.active(this) || this.data.creating || !this.data.rechargeEnabled) return
    const amount = amountCents(this.data.useCustom ? this.data.custom : this.data.selected)
    if (amount == null) return
    const paymentMode = 'PAGE'
    if (!this._attempt || this._attempt.amountCents !== amount || this._attempt.paymentMode !== paymentMode)
      this._attempt = { amountCents: amount, clientRequestId: social.requestId(), paymentMode }
    const version = this._communityVersion
    this.setData({ creating: true })
    try {
      const order = await api.recharge(this._attempt)
      if (!social.active(this, version)) return
      this._attempt = null; this.setData({ creating: false })
      wx.navigateTo({ url: `/pages/sandbox-payment/sandbox-payment?orderNo=${encodeURIComponent(order.orderNo)}` })
    } catch (error) {
      if (!social.active(this, version)) return
      this.setData({ creating: false }); social.failure(this, error, version)
    }
  },
  onOrders(event) {
    const type = event.currentTarget.dataset.type === 'RECHARGE' ? 'RECHARGE' : 'CONSULTATION'
    wx.navigateTo({ url: `/pages/my-orders/my-orders?type=${type}` })
  },
  onWithdrawals(){if(social.active(this)&&this.data.withdrawalEligible)wx.navigateTo({url:'/pages/doctor-withdrawals/doctor-withdrawals'})},
  onRetry() { return this.load() },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } }
})
