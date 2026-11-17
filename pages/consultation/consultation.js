const api = require('../../services/consultation')
const social = require('../../utils/community')
const { TOPICS, decorate } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const HIDE_MINE_KEY = 'consultationHideMine'

Page({
  data: { displayStyle: '', topics: TOPICS, topic: '', records: [], loading: false, error: '',
    capabilities: api.PREVIEW_CAPABILITIES, pageNum: 0, hasMore: false, hideMine: false },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this)
    try { this.setData({ hideMine: wx.getStorageSync(HIDE_MINE_KEY) === true }) } catch (_) {}
    applyDisplayToCurrentPage()
    const tab = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tab) { tab.setData({ selected: 1 }); if (tab.refreshGuide) tab.refreshGuide() }
    this.load(true)
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load(reset = true) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1
    if (reset) this.setData({ records: [], pageNum: 0, hasMore: false })
    this.setData({ loading: true, error: '' })
    try {
      const [capabilities, page] = await Promise.all([
        api.capabilities(), api.list({ pageNum, pageSize: 10, topic: this.data.topic, hideMine: this.data.hideMine })
      ])
      if (!social.active(this, version) || run !== this._run) return
      const rows = (page.records || []).map(decorate)
      this.setData({ capabilities, records: reset ? rows : this.data.records.concat(rows),
        pageNum, hasMore: pageNum < Number(page.pages), loading: false })
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ loading: false, error: error.message || '问诊内容加载失败，请重试' })
      social.failure(this, error, version)
    }
  },
  onTopic(event) {
    const topic = event.currentTarget.dataset.code
    if (!TOPICS.some(item => item.code === topic) || topic === this.data.topic) return
    this.setData({ topic }); this.load(true)
  },
  onToggleHideMine() {
    if (!social.active(this)) return
    const hideMine = !this.data.hideMine
    this.setData({ hideMine })
    try { wx.setStorageSync(HIDE_MINE_KEY, hideMine) } catch (_) {}
    return this.load(true)
  },
  onDoctor() { wx.navigateTo({ url: '/pages/consultation-doctor/consultation-doctor' }) },
  onCompose() { wx.navigateTo({ url: '/pages/consultation-compose/consultation-compose' }) },
  onRecords() { wx.navigateTo({ url: '/pages/consultation-records/consultation-records' }) },
  onPreview() { wx.navigateTo({ url: '/pages/consultation-detail/consultation-detail?preview=1' }) },
  onOpen(event) {
    const item = this.data.records.find(row => row.id === String(event.currentTarget.dataset.id))
    if (item) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${encodeURIComponent(item.id)}` })
  },
  onRetry() { return this.load(true) },
  onReachBottom() { return this.load(false) },
  async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } }
})
