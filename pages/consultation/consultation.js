const api = require('../../services/consultation')
const social = require('../../utils/community')
const { decorate } = require('../../utils/consultation')
const topicSettings = require('../../utils/consultation-topics')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const OWNER_OPTIONS = [
  { value: 'ALL', label: '全部求助' },
  { value: 'MINE', label: '我的求助' },
  { value: 'OTHERS', label: '其他人的求助' }
]
const ASSIGNED_OPTION = { value: 'ASSIGNED', label: '我的接诊' }
const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'WAITING', label: '等待医生' },
  { value: 'IN_PROGRESS', label: '接诊中' },
  { value: 'REPORT_READY', label: '已出具问诊单' },
  { value: 'CLOSED', label: '已结束' }
]
function selectedSummary(owner, status, options) {
  const summary = []
  if (owner !== 'ALL') summary.push(options.find(item => item.value === owner).label)
  if (status) summary.push(STATUS_OPTIONS.find(item => item.value === status).label)
  return summary
}

Page({
  data: { displayStyle: '', topics: [{code: '', name: '全部求助'}], catalog: [], topic: '', topicAnchor: '', records: [], loading: false, error: '',
    capabilities: api.PREVIEW_CAPABILITIES, pageNum: 0, hasMore: false,
    filterOwner: 'ALL', filterStatus: '', filterCount: 0, filterSummary: [], filterOpen: false,
    draftOwner: 'ALL', draftStatus: '', doctorApproved: false, ownerOptions: OWNER_OPTIONS, statusOptions: STATUS_OPTIONS },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this)
    const app = getApp()
    if (app.globalData) this.setData({informationCounts:app.globalData.informationCounts || {}})
    if (previous !== this._communityToken) this.setData({ filterOwner: 'ALL', filterStatus: '', filterCount: 0,
      filterSummary: [], filterOpen: false, draftOwner: 'ALL', draftStatus: '', doctorApproved: false, ownerOptions: OWNER_OPTIONS,
      records: [], topic: '', topicAnchor: '', catalog: [], topics: [{code:'',name:'全部求助'}] })
    applyDisplayToCurrentPage()
    const tab = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tab) { tab.setData({ selected: 1 }); if (tab.refreshGuide) tab.refreshGuide() }
    this.load(true)
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1; this.setData({ filterOpen: false }) },
  onUnload() { this.onHide() },
  onConversations() { if (social.active(this)) wx.navigateTo({url:'/pages/consultation-conversations/consultation-conversations'}) },
  async load(reset = true) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    let pageNum = reset ? 1 : this.data.pageNum + 1
    if (reset) this.setData({ records: [], pageNum: 0, hasMore: false })
    this.setData({ loading: true, error: '' })
    try {
      const [capabilities, rawTopics, doctor] = await Promise.all([
        api.capabilities(), reset ? api.topics() : Promise.resolve(this.data.catalog),
        reset ? api.doctor().catch(error => {
          if (error.statusCode === 404 || error.statusCode === 501) return null
          throw error
        }) : Promise.resolve(this.data.doctorApproved ? {status:'APPROVED'} : null)
      ])
      if (!social.active(this, version) || run !== this._run) return
      const doctorApproved = !!doctor && doctor.status === 'APPROVED'
      const ownerOptions = doctorApproved ? [...OWNER_OPTIONS, ASSIGNED_OPTION] : OWNER_OPTIONS
      const filterOwner = ownerOptions.some(item => item.value === this.data.filterOwner) ? this.data.filterOwner : 'ALL'
      if (filterOwner !== this.data.filterOwner) {
        pageNum = 1
        this.setData({records:[],pageNum:0,hasMore:false})
      }
      const filterSummary = selectedSummary(filterOwner, this.data.filterStatus, ownerOptions)
      this.setData({ doctorApproved, ownerOptions, filterOwner, filterSummary, filterCount:filterSummary.length,
        draftOwner: ownerOptions.some(item => item.value === this.data.draftOwner) ? this.data.draftOwner : 'ALL' })
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
      this.setData({ capabilities })
      const page = await api.list({ pageNum, pageSize: 10, topic: this.data.topic,
        mine: this.data.filterOwner === 'MINE', hideMine: this.data.filterOwner === 'OTHERS',
        assigned: this.data.filterOwner === 'ASSIGNED',
        status: this.data.filterStatus })
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
  onOpenFilters() {
    if (!social.active(this)) return
    this.setData({ filterOpen: true, draftOwner: this.data.filterOwner, draftStatus: this.data.filterStatus })
  },
  onCloseFilters() { this.setData({ filterOpen: false }) },
  onFilterPanelTap() {},
  onFilterTouchMove() {},
  onDraftOwner(event) {
    const value = event.currentTarget.dataset.value
    if (this.data.ownerOptions.some(item => item.value === value)) this.setData({ draftOwner: value })
  },
  onDraftStatus(event) {
    const value = event.currentTarget.dataset.value
    if (STATUS_OPTIONS.some(item => item.value === value)) this.setData({ draftStatus: value })
  },
  onResetFilters() { this.setData({ draftOwner: 'ALL', draftStatus: '' }) },
  onApplyFilters() {
    if (!social.active(this)) return
    const owner = this.data.draftOwner, status = this.data.draftStatus
    if (!this.data.ownerOptions.some(item => item.value === owner)) return
    const changed = owner !== this.data.filterOwner || status !== this.data.filterStatus
    const summary = selectedSummary(owner, status, this.data.ownerOptions)
    this.setData({ filterOpen: false, filterOwner: owner, filterStatus: status,
      filterSummary: summary, filterCount: summary.length })
    if (!changed) return
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
