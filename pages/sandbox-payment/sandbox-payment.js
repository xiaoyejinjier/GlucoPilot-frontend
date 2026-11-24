const api = require('../../services/wallet')
const social = require('../../utils/community')
const { money } = require('../../utils/consultation')
const { expiryTime, isSandboxPageUrl } = require('../../utils/sandbox-payment')
const { applyDisplayToCurrentPage } = require('../../utils/display')

// 沙箱付款状态页：打开收银台并向后端查询结果，钱包入账完全由后端确认。
Page({
  data: {
    displayStyle: '', loading: false, checking: false, opening: false,
    paid: false, closed: false, expired: false, ready: false, legacy: false,
    orderNo: '', price: '—', expires: '', error: '', paused: false
  },
  onLoad(options) {
    // 页面只接收并检查业务订单号，金额、付款链接及支付结果均从后端获取。
    this._orderNo = /^[A-Za-z0-9_-]{1,64}$/.test(options.orderNo || '') ? options.orderNo : ''
  },
  onShow() {
    if (!getApp().checkLogin()) return
    // 页面重新显示时绑定当前登录身份并加载订单，离开收银台返回后也会重新核对状态。
    social.begin(this)
    applyDisplayToCurrentPage()
    this.setData({ orderNo: this._orderNo, paid: false, closed: false, price: '—', opening: false })
    this.load()
  },
  stopPolling() {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  },
  stopExpiry() {
    if (this._expiryTimer) clearTimeout(this._expiryTimer)
    this._expiryTimer = null
  },
  markExpired() {
    // 链接到期只代表不能继续使用该入口付款，后续仍可查单，不能把它直接当作付款失败。
    this.stopPolling()
    this.stopExpiry()
    this.setData({ expired: true, ready: false, paused: false, loading: false,
      error: '付款链接已过期，请查询付款结果或重新充值' })
  },
  onHide() {
    // 离页停止轮询/计时，并使旧请求回调失效，避免后台请求或旧账号结果覆盖当前页面。
    social.end(this)
    this.stopPolling()
    this.stopExpiry()
    this.setData({ ready: false, opening: false })
    this._run = (this._run || 0) + 1
  },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    // version校验登录/页面身份，run区分本页不同轮加载，迟到响应不能覆盖较新的状态。
    const version = this._communityVersion
    const run = this._run = (this._run || 0) + 1
    this.stopPolling()
    this.stopExpiry()
    this._polls = 0
    this.setData({ loading: true, ready: false, legacy: false, error: '', checking: false,
      expired: false, paused: false })
    if (!this._orderNo) {
      this.setData({ loading: false, error: '订单不存在' })
      return
    }
    try {
      // 【1. 获取付款信息】后端核验本人订单，返回金额、有效期、付款方式和当前交易状态。
      const payment = await api.payment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ price: money(payment.amountCents), paid: payment.status === 'PAID',
        closed: payment.status === 'CLOSED', expires: social.timeLabel(payment.expiresAt) })
      if (payment.status === 'PENDING') {
        // 【2. 校验有效期】已过期或时间异常时不开放收银台；过期后再向后端核实一次结果。
        this._expiresAt = expiryTime(payment.expiresAt)
        const remaining = this._expiresAt - Date.now()
        if (!Number.isFinite(remaining)) throw new Error('付款有效期异常，请重试')
        if (remaining <= 0) {
          this.markExpired()
          this.refresh(true)
          return
        }
        if (payment.paymentMode === 'PAGE') {
          // 当前入口采用网页付款，链接必须通过沙箱地址校验；旧扫码订单单独提示。
          if (!isSandboxPageUrl(payment.pageUrl)) throw new Error('网页付款链接加载失败，请重试')
          this.setData({ ready: true })
        } else {
          this.setData({ legacy: true })
        }
        this._expiryTimer = setTimeout(() => {
          if (!social.active(this, version) || run !== this._run) return
          this.markExpired()
          this.refresh(true)
        }, remaining)
      }
      this.setData({ loading: false })
      if (payment.status === 'PENDING') {
        // 【3. 查询状态】待支付时每5秒请求后端查单；到第36个轮询时暂停，可手动继续查询。
        this._timer = setInterval(() => {
          if (!social.active(this, version)) return
          if (++this._polls >= 36) {
            this.stopPolling()
            this.setData({ paused: true })
            return
          }
          this.refresh(true)
        }, 5000)
        this.refresh(true)
      }
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, ready: false })
      if (error.code === 40900 && /已过期/.test(error.message || '')) {
        this.markExpired()
        this.refresh(true)
        return
      }
      this.stopExpiry()
      this.setData({ error: error.message || '网页付款链接加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  async refresh(quiet = false) {
    if (!social.active(this) || !this._orderNo || this.data.checking) return
    const version = this._communityVersion, run = this._run
    this.setData({ checking: true })
    try {
      // 这一步调用后端主动查单接口，不接受页面自行指定PAID，也不因“打开过收银台”认定成功。
      const order = await api.refreshPayment(this._orderNo)
      if (!social.active(this, version) || run !== this._run) return
      const paid = order.status === 'PAID', closed = order.status === 'CLOSED'
      this.setData({ paid, closed, price: money(order.amountCents), checking: false,
        ...(paid || closed ? { ready: false, error: '', expired: false } : {}) })
      if (paid || closed) {
        // 收到后端确认的已付款/已关闭状态后，停止轮询和有效期计时。
        this.stopPolling()
        this.stopExpiry()
      }
      if (!quiet && !paid && !closed) wx.showToast({ title: '暂未确认付款，请稍后再查', icon: 'none' })
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ checking: false })
      if (!quiet || error.code === 40100) social.failure(this, error, version)
    }
  },
  onOpenPayment() {
    // 【4. 打开收银台】防连点并检查状态；跳转参数只带订单号，不携带密钥、余额或付款密码。
    if (!social.active(this) || !this.data.ready || this.data.loading || this.data.opening
        || this.data.checking || this.data.paid || this.data.closed || this.data.expired) return
    if (this._expiresAt <= Date.now()) {
      this.markExpired()
      return
    }
    const version = this._communityVersion, run = this._run
    this.setData({ opening: true })
    wx.navigateTo({
      // 独立收银台页面负责加载沙箱付款入口和付款后的返回交互。
      url: `/pages/sandbox-cashier/sandbox-cashier?orderNo=${encodeURIComponent(this._orderNo)}`,
      fail: () => {
        if (!social.active(this, version) || run !== this._run) return
        this.setData({ opening: false })
        wx.showToast({ title: '付款页面打开失败，请重试', icon: 'none' })
      }
    })
  },
  // 手动查询与自动轮询复用同一个后端确认流程，只有手动查询才提示“暂未确认付款”。
  onRefresh() { return this.refresh(false) },
  onRetry() { return this.load() },
  onRecharge() {
    if (social.active(this) && !this.data.checking && !this.data.paid)
      wx.redirectTo({ url: '/pages/wallet/wallet' })
  },
  onDetails() {
    // 查看后端保存的订单详情及交易后余额，不在前端推算或修改账户金额。
    if (social.active(this))
      wx.redirectTo({ url: `/pages/order-detail/order-detail?type=RECHARGE&orderNo=${encodeURIComponent(this._orderNo)}` })
  }
})
