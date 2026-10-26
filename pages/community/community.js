const api = require('../../services/api')
const social = require('../../utils/community')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const TITLES = { following: '我的关注', collections: '我的收藏', messages: '我的私信', profiles: '找用户' }
Page({
  data: { displayStyle: '', mode: 'following', list: [], pageNum: 0, hasMore: false, loading: false, error: '', keyword: '', searchQuery: '' },
  onLoad(options) { const mode = Object.prototype.hasOwnProperty.call(TITLES, options.mode) ? options.mode : 'following'; this.setData({ mode }); wx.setNavigationBarTitle({ title: TITLES[mode] }) },
  onShow() {
    if (!getApp().checkLogin()) return
    const oldToken = this._communityToken; social.begin(this); this.stopPolling(); this._busy = false
    this._loadRun=(this._loadRun||0)+1
    this.setData({ list: [], pageNum: 0, hasMore: false, loading: false, error: '', ...(oldToken && oldToken !== this._communityToken ? { keyword: '', searchQuery:'' } : {}) })
    applyDisplayToCurrentPage()
    if (this.data.mode !== 'profiles' || this.data.keyword.trim().length >= 2) this.load(true)
    if (this.data.mode === 'messages') this._pollTimer = setInterval(() => {
      if (this.data.pageNum <= 1) this.load(true, true)
    }, 5000)
  },
  stopPolling() { if (this._pollTimer) clearInterval(this._pollTimer); this._pollTimer = null },
  onHide() { social.end(this); this.stopPolling() }, onUnload() { social.end(this); this.stopPolling() },
  onInput(event) { this.setData({ keyword: event.detail.value }) },
  onSearch() {
    if (this.data.mode === 'profiles' && this.data.keyword.trim().length < 2) { wx.showToast({ title: '请输入对方的昵称', icon: 'none' }); return }
    return this.load(true)
  },
  onClearSearch() {
    this.setData({keyword:''})
    if(this.data.mode==='profiles'){this._loadRun=(this._loadRun||0)+1;this._busy=false;this._queryKeyword='';this.setData({list:[],searchQuery:'',pageNum:0,hasMore:false,loading:false,error:''});return}
    return this.load(true)
  },
  onRetry() { return this.load(true) }, onMore() { return this.load(false) },
  async load(reset, quiet = false) {
    if (!social.active(this) || (!reset && (this._busy || !this.data.hasMore))) return
    this._busy = true; const version = this._communityVersion, run=this._loadRun=(this._loadRun||0)+1, pageNum = reset ? 1 : this.data.pageNum + 1
    const keyword = this.data.mode !== 'messages' ? (reset ? this.data.keyword.trim() : this._queryKeyword) : ''
    if (reset) this._queryKeyword = keyword
    this.setData({ ...(!quiet ? { loading: true } : {}), error: '', ...(reset&&!quiet ? {list:[],pageNum:0,hasMore:false,searchQuery:keyword} : {}) })
    try {
      let page
      if (this.data.mode === 'profiles' && /^u[1-9]\d{0,18}$/.test(keyword)) {
        const profile = await api.fetchCommunityProfile(keyword)
        page = { records: [profile], pages: 1 }
      } else page = await api.fetchCommunityList(this.data.mode, { pageNum, pageSize: 20, ...(keyword ? { keyword } : {}) })
      if (!social.active(this, version) || run!==this._loadRun) return
      const incoming = page.records.map(item => ({ ...item, unreadCount:Math.max(0,Number(item.unreadCount) || 0), unreadLabel:Number(item.unreadCount) > 99 ? '99+' : String(Number(item.unreadCount) || 0), rowKey: item.key || item.id || item.peer.key,
        timeLabel: social.timeLabel(item.lastMessage && item.lastMessage.createdAt) }))
      const map = new Map((reset ? [] : this.data.list).map(item => [item.rowKey, item])); incoming.forEach(item => map.set(item.rowKey, item))
      this.setData({ list: Array.from(map.values()), pageNum, hasMore: pageNum < Number(page.pages) })
    } catch (error) { if (social.active(this, version, error) && run===this._loadRun) { this.setData({ error: error.message || '加载失败，点击重试' }); if (!quiet || error.code === 40100) social.failure(this, error, version) } }
    finally { if (social.active(this, version) && run===this._loadRun) { this._busy = false; this.setData({ loading: false }) } }
  },
  onOpen(event) {
    const row = this.data.list.find(item => item.rowKey === event.currentTarget.dataset.key)
    if (!row) return
    const url = this.data.mode === 'collections' ? `/pages/news-detail/news-detail?id=${row.id}`
      : this.data.mode === 'messages' ? `/pages/messages/messages?peer=${row.peer.userId}`
        : `/pages/community-profile/community-profile?key=${row.key}`
    wx.navigateTo({ url })
  }
})
