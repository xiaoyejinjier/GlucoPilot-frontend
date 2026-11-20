const api = require('../../services/consultation')
const social = require('../../utils/community')
const { decorate, money, STATUS, identifier } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', tab: 'requests', records: [], loading: false, error: '', pageNum: 0, hasMore: false },
  onLoad(options) { if (options.tab === 'orders') this.setData({ tab: 'orders' }) },
  onShow() { if (!getApp().checkLogin()) return; social.begin(this); applyDisplayToCurrentPage(); this.load(true) },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load(reset = true) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1, orders = this.data.tab === 'orders'
    this.setData({ loading: true, error: '', ...(reset ? { records: [], hasMore: false } : {}) })
    try {
      const query = { mine: true, pageNum, pageSize: 10 }
      const page = await (orders ? api.orders(query) : api.list(query))
      if (!social.active(this, version) || run !== this._run) return
      const rows = (page.records || []).map(item => orders ? {
        ...item, id: String(item.orderNo), title: item.title || '问诊单查看服务',
        statusLabel: STATUS[item.status] || '处理中', price: money(item.amountCents)
      } : { ...decorate(item),
        reportReady: item.status === 'REPORT_READY',
        hasDoctor: ['IN_PROGRESS', 'REPLIED', 'REPORT_READY'].includes(item.status),
        statusTone: item.status === 'REPORT_READY' ? 'report' : ['IN_PROGRESS', 'REPLIED'].includes(item.status) ? 'active' : item.status === 'CLOSED' ? 'closed' : 'waiting',
        progressNote: item.status === 'REPORT_READY' ? '医生已出具问诊单，进入详情查看' : ['IN_PROGRESS', 'REPLIED'].includes(item.status) ? '医生正在跟进，可进入交流补充情况' : item.status === 'CLOSED' ? '本次问诊已结束，可查看历史详情' : '求助已发布，等待医生接诊'
      })
      this.setData({ records: reset ? rows : this.data.records.concat(rows), pageNum,
        hasMore: pageNum < Number(page.pages), loading: false })
    } catch (error) {
      if (social.active(this, version) && run === this._run) {
        this.setData({ loading: false, error: error.message || '问诊记录加载失败' }); social.failure(this, error, version)
      }
    }
  },
  onTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (!['requests', 'orders'].includes(tab) || tab === this.data.tab) return
    this.setData({ tab }); this.load(true)
  },
  onOpen(event) {
    const row = this.data.records.find(item => item.id === String(event.currentTarget.dataset.id))
    if (row && this.data.tab === 'orders') {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?type=CONSULTATION&orderNo=${encodeURIComponent(row.orderNo)}` })
      return
    }
    const id = row && identifier(row.id)
    if (id) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${id}` })
  },
  onCompose() { wx.navigateTo({ url: '/pages/consultation-compose/consultation-compose' }) },
  onChat(event) {
    const row = this.data.records.find(item => item.id === String(event.currentTarget.dataset.id))
    const id = row && row.hasDoctor && identifier(row.id)
    if (social.active(this) && id) wx.navigateTo({ url: `/pages/consultation-chat/consultation-chat?id=${id}` })
  },
  onConversations() { if (social.active(this)) wx.navigateTo({ url: '/pages/consultation-conversations/consultation-conversations' }) },
  onRetry() { return this.load(true) },
  onReachBottom() { return this.load(false) },
  async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } }
})
