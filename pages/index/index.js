const api = require('../../services/api')
const { mapField } = require('../../utils/remote-image')
const social = require('../../utils/community')
const { TAGS, reportUrl } = require('../../utils/publication')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', tags: TAGS, activeTag: '', feedMode: 'recommend', keyword: '', posts: [],
    loading: false, error: '', pageNum: 0, hasMore: false },
  onShow() {
    if (!getApp().checkLogin()) return
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tabBar) { tabBar.setData({ selected: 2 }); if (tabBar.refreshGuide) tabBar.refreshGuide() }
    const token = this._communityToken; social.begin(this); applyDisplayToCurrentPage()
    if (token && token !== this._communityToken) this.setData({ posts: [], keyword: '', activeTag: '', feedMode: 'recommend' })
    this._busy = new Set(); this.load(true)
    const version = this._communityVersion
    api.fetchCommunityTags().then(tags => { if (social.active(this, version) && tags.length) this.setData({ tags }) }).catch(() => {})
  },
  onHide() { social.end(this); this._loadRun = (this._loadRun || 0) + 1 },
  onUnload() { this.onHide() },
  async load(reset) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._loadRun = (this._loadRun || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1
    this.setData({ loading: true, error: '' })
    try {
      const page = await api.fetchCommunityArticles({ pageNum, pageSize: 15, tag: this.data.activeTag,
        following: this.data.feedMode === 'following', keyword: this.data.keyword.trim() })
      if (!social.active(this, version) || run !== this._loadRun) return
      const records = (await mapField(page.records || [], 'cover')).map(post => ({ ...post, timeLabel: social.timeLabel(post.publishAt || post.createdAt) }))
      if (!social.active(this, version) || run !== this._loadRun) return
      const map = new Map((reset ? [] : this.data.posts).map(post => [post.id, post])); records.forEach(post => map.set(post.id, post))
      this.setData({ posts: Array.from(map.values()), pageNum, hasMore: pageNum < Number(page.pages), loading: false })
    } catch (error) {
      if (!social.active(this, version, error) || run !== this._loadRun) return
      this.setData({ loading: false, error: error.message || '社区加载失败，请重试', ...(reset ? { posts: [], hasMore: false } : {}) })
      if (error.code === 40100) social.failure(this, error, version)
    }
  },
  onMode(e) { const mode = e.currentTarget.dataset.mode; if (!['recommend','following'].includes(mode) || mode === this.data.feedMode) return; this.setData({ feedMode: mode, posts: [] }); this.load(true) },
  onTag(e) { const code = e.currentTarget.dataset.code || ''; if (code === this.data.activeTag) return; this.setData({ activeTag: code, posts: [] }); this.load(true) },
  onSearchInput(e) { this.setData({ keyword: e.detail.value }) },
  onSearch() { this.load(true) }, onRetry() { this.load(true) }, onMore() { this.load(false) }, onReachBottom() { this.load(false) },
  async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } },
  onWrite() { wx.navigateTo({ url: '/pages/community-compose/community-compose' }) },
  onMyArticles() { wx.navigateTo({ url: '/pages/community-articles/community-articles' }) },
  onOpen(e) { const id = String(e.currentTarget.dataset.id || ''); if (/^[1-9]\d{0,18}$/.test(id)) wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${id}` }) },
  onProfile(e) { const key = e.currentTarget.dataset.key; if (/^[ub][1-9]\d{0,18}$/.test(String(key || ''))) wx.navigateTo({ url: `/pages/community-profile/community-profile?key=${key}` }) },
  onCommunityEntry(e) { if(e.currentTarget.dataset.mode === 'messages') { wx.navigateTo({url:'/pages/information/information'}); return } const mode = e.currentTarget.dataset.mode; if (['following','collections','messages','profiles'].includes(mode)) wx.navigateTo({ url: `/pages/community/community?mode=${mode}` }) },
  onReport(e) { const url = reportUrl('ARTICLE',e.currentTarget.dataset.id); if (url) wx.navigateTo({ url }) },
  async onAction(e) {
    const id = String(e.currentTarget.dataset.id), field = e.currentTarget.dataset.field
    const post = this.data.posts.find(item => item.id === id)
    if (!post || !['liked','collected'].includes(field) || !social.active(this)) return
    if (!this._busy) this._busy = new Set()
    if (this._busy.has(id)) return
    this._busy.add(id); const version = this._communityVersion
    try { const result = await api.updateNewsAction(id,{ [field]: !post[field] }); if (social.active(this,version)) this.setData({ posts: this.data.posts.map(item => item.id === id ? { ...item, ...result } : item) }) }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this._busy.delete(id) }
  },
  async onFollow(e) {
    const key = e.currentTarget.dataset.key, post = this.data.posts.find(item => item.author && item.author.key === key)
    if (!post || post.author.isSelf || !social.active(this)) return
    const busy = `follow:${key}`; if (this._busy.has(busy)) return
    this._busy.add(busy); const version = this._communityVersion
    try { const profile = await api.setCommunityFollowing(key,!post.author.followed); if (social.active(this,version)) this.setData({ posts: this.data.posts.map(item => item.author && item.author.key === key ? { ...item, author: profile } : item) }) }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this._busy.delete(busy) }
  }
})
