const api = require('../../services/consultation')
const social = require('../../utils/community')
const { decorate } = require('../../utils/consultation')
const topicSettings = require('../../utils/consultation-topics')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const HIDE_MINE_KEY = 'consultationHideMine'

Page({
  data: { displayStyle: '', topics: [{code: '', name: '全部求助'}], catalog: [], topic: '', topicAnchor: '', records: [], loading: false, error: '',
    capabilities: api.PREVIEW_CAPABILITIES, pageNum: 0, hasMore: false, hideMine: false,
    doctorApproved: false, unclaimedOnly: false },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this)
    const app = getApp()
    if (app.globalData) this.setData({informationCounts:app.globalData.informationCounts || {}})
    if (previous !== this._communityToken) this.setData({ doctorApproved: false, unclaimedOnly: false, records: [], topic: '', topicAnchor: '', catalog: [], topics: [{code:'',name:'全部求助'}] })
    try { this.setData({ hideMine: wx.getStorageSync(HIDE_MINE_KEY) === true }) } catch (_) {}
    applyDisplayToCurrentPage()
    const tab = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tab) { tab.setData({ selected: 1 }); if (tab.refreshGuide) tab.refreshGuide() }
    this.load(true)
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  onConversations() { if (social.active(this)) wx.navigateTo({url:'/pages/consultation-conversations/consultation-conversations'}) },
  async load(reset = true) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1
    if (reset) this.setData({ records: [], pageNum: 0, hasMore: false })
    this.setData({ loading: true, error: '' })
    try {
      const [capabilities, doctor, rawTopics] = await Promise.all([
        api.capabilities(), api.doctor().catch(error => {
          if (error.statusCode === 404 || error.statusCode === 501) return null
          throw error
        }), reset ? api.topics() : Promise.resolve(this.data.catalog)
      ])
      if (!social.active(this, version) || run !== this._run) return
      const catalog = topicSettings.normalize(rawTopics)
      const topic = catalog.some(item => item.code === this.data.topic) ? this.data.topic : ''
      const frequent = topicSettings.read(catalog)
      // 从全部标签选中未收藏分类时，也把当前筛选显示在栏中。
      if (topic && !frequent.some(item => item.code === topic)) frequent.push(catalog.find(item => item.code === topic))
      this.setData({catalog, topic, topics: [{code:'',name:'全部求助'}, ...frequent], topicAnchor: ''}, () => {
        // 等标签渲染后定位选中项，同一标签再次返回也能重新滚入可视区域。
        wx.nextTick(() => {
          if (social.active(this, version) && run === this._run)
            this.setData({topicAnchor: `consult-topic-${topic || 'all'}`})
        })
      })
      const doctorApproved = !!doctor && doctor.status === 'APPROVED'
      const unclaimedOnly = doctorApproved && this.data.unclaimedOnly
      this.setData({ doctorApproved, unclaimedOnly, capabilities })
      const page = await api.list({ pageNum, pageSize: 10, topic: this.data.topic,
        hideMine: this.data.hideMine, unclaimedOnly })
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
    if (!this.data.topics.some(item => item.code === topic) || topic === this.data.topic) return
    this.setData({ topic }); this.load(true)
  },
  onManageTopics() {
    if (!social.active(this)) return
    const token = this._communityToken
    wx.navigateTo({url: `/pages/consultation-topics/consultation-topics?selected=${encodeURIComponent(this.data.topic)}`,
      events: { selectTopic: item => {
        if (social.sameAccount(this, token)) this.setData({topic: item.code})
      } }})
  },
  onToggleHideMine() {
    if (!social.active(this)) return
    const hideMine = !this.data.hideMine
    this.setData({ hideMine })
    try { wx.setStorageSync(HIDE_MINE_KEY, hideMine) } catch (_) {}
    return this.load(true)
  },
  onUnclaimedFilter(event) {
    if (!social.active(this) || !this.data.doctorApproved) return
    const unclaimedOnly = event.currentTarget.dataset.filter === 'unclaimed'
    if (unclaimedOnly === this.data.unclaimedOnly) return
    this.setData({ unclaimedOnly })
    return this.load(true)
  },
  onDoctor() { wx.navigateTo({ url: '/pages/consultation-doctor/consultation-doctor' }) },
  onCompose() { wx.navigateTo({ url: '/pages/consultation-compose/consultation-compose' }) },
  onRecords() { wx.navigateTo({ url: '/pages/consultation-records/consultation-records' }) },
  onOpen(event) {
    const item = this.data.records.find(row => row.id === String(event.currentTarget.dataset.id))
    if (item) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${encodeURIComponent(item.id)}` })
  },
  onRetry() { return this.load(true) },
  onReachBottom() { return this.load(false) },
  async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } }
})
