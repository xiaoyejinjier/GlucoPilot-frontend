const api = require('../../services/api')
const social = require('../../utils/community')
const notices = require('../../utils/message-notifications')
const { getToken } = require('../../utils/request')
const { mapField } = require('../../utils/remote-image')
const { applyDisplayToCurrentPage } = require('../../utils/display')

const TABS = [
  { key: 'messages', label: '私信', symbol: '✉', group: 'messages' },
  { key: 'likes', kind: 'LIKE', label: '收到的点赞', symbol: '♡', group: 'likes' },
  { key: 'myLikes', mode: 'likes', label: '我的点赞', symbol: '♡', group: 'likes' },
  { key: 'collections', kind: 'COLLECT', label: '收到的收藏', symbol: '☆', group: 'collections' },
  { key: 'myCollections', mode: 'collections', label: '我的收藏', symbol: '☆', group: 'collections' },
  { key: 'comments', kind: 'COMMENT', label: '收到的评论', symbol: '评', group: 'comments' },
  { key: 'myComments', label: '我的评论', symbol: '说', group: 'comments' },
  { key: 'follows', kind: 'FOLLOW', label: '新关注我的', symbol: '友', group: 'follows' },
  { key: 'following', mode: 'following', label: '我的关注', symbol: '友', group: 'follows' }
]
const GROUPS = {
  messages: { title: '信息', subtitle: '和糖友聊聊，看看新的私信', keys: ['messages'] },
  comments: { title: '评论', subtitle: '收到的回应与自己的留言', keys: ['comments', 'myComments'] },
  likes: { title: '点赞', subtitle: '喜欢的内容与收到的认可', keys: ['myLikes', 'likes'] },
  collections: { title: '收藏', subtitle: '珍藏的内容与收到的收藏', keys: ['myCollections', 'collections'] },
  follows: { title: '关注', subtitle: '关注的糖友与新关注你的朋友', keys: ['following', 'follows'] }
}

Page({
  data: { displayStyle: '', group: 'messages', title: '信息', subtitle: '', tabs: [], activeTab: 'messages',
    informationCounts: {}, list: [], loading: false, error: '', pageNum: 0, hasMore: false,
    searchable: false, keyword: '', searchQuery: '', searchPlaceholder: '' },
  onLoad(options = {}) {
    const requested = TABS.find(tab => tab.key === options.tab)
    const group = Object.prototype.hasOwnProperty.call(GROUPS, options.group) ? options.group : requested ? requested.group : 'messages'
    const section = GROUPS[group]
    const tabs = section.keys.map(key => TABS.find(tab => tab.key === key))
    const activeTab = requested && requested.group === group ? requested.key : section.keys[0]
    this.setData({ group, title: section.title, subtitle: section.subtitle, tabs, activeTab })
    this.configureSearch()
    wx.setNavigationBarTitle({ title: section.title })
  },
  configureSearch() {
    const tab = this.data.tabs.find(item => item.key === this.data.activeTab)
    this.setData({ searchable: !!(tab && tab.mode),
      searchPlaceholder: tab && tab.mode === 'following' ? '搜索已关注的昵称' : '搜索文章标题' })
  },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this); applyDisplayToCurrentPage(); this._busy = false
    this.setData({ list: [], pageNum: 0, hasMore: false, loading: false, error: '',
      ...(previous && previous !== this._communityToken ? { keyword: '', searchQuery: '' } : {}) })
    this.load(true)
    if (this._timer) clearInterval(this._timer)
    this._timer = setInterval(() => { if (this.data.pageNum <= 1) this.load(true, true) }, 5000)
  },
  onHide() {
    social.end(this); this._run = (this._run || 0) + 1; this._busy = false
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  },
  onUnload() { this.onHide() },
  onTab(event) {
    const key = event.currentTarget.dataset.key
    if (key === this.data.activeTab || !this.data.tabs.some(tab => tab.key === key)) return
    this._run = (this._run || 0) + 1; this._busy = false
    this.setData({ activeTab: key, list: [], pageNum: 0, hasMore: false, keyword: '', searchQuery: '' })
    this.configureSearch(); this.load(true)
  },
  onInput(event) { this.setData({ keyword: event.detail.value }) },
  onSearch() { this._busy = false; return this.load(true) },
  onClearSearch() { this.setData({ keyword: '' }); return this.onSearch() },
  async load(reset, quiet = false) {
    if (!social.active(this) || this._busy || (!reset && !this.data.hasMore)) return
    this._busy = true
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    const tab = this.data.tabs.find(item => item.key === this.data.activeTab)
    const pageNum = reset ? 1 : this.data.pageNum + 1
    const keyword = tab.mode ? (reset && !quiet ? this.data.keyword.trim() : this.data.searchQuery) : ''
    this.setData({ error: '', ...(!quiet ? { loading: true } : {}),
      ...(reset && !quiet ? { list: [], hasMore: false, searchQuery: keyword } : {}) })
    try {
      const query = { pageNum, pageSize: 20, ...(keyword ? { keyword } : {}) }
      const page = tab.key === 'myComments' ? await api.fetchMyComments(query)
        : tab.kind ? await api.fetchInteractionNotices(tab.kind, query)
          : await api.fetchCommunityList(tab.mode || 'messages', query)
      if (!social.active(this, version) || run !== this._run) return
      const source = tab.mode && tab.mode !== 'following' ? await mapField(page.records || [], 'cover') : page.records || []
      if (!social.active(this, version) || run !== this._run) return
      const records = source.map(item => this.decorate(item, tab))
      const map = new Map((reset ? [] : this.data.list).map(item => [item.rowKey, item]))
      records.forEach(item => map.set(item.rowKey, item))
      this.setData({ list: Array.from(map.values()), pageNum, hasMore: pageNum < Number(page.pages) })
      notices.refresh()
    } catch (error) {
      if (social.active(this, version, error) && run === this._run) {
        this.setData({ error: error.message || '信息加载失败，请重试' })
        if (error.code === 40100) social.failure(this, error, version)
      }
    } finally {
      if (social.active(this, version) && run === this._run) { this._busy = false; this.setData({ loading: false }) }
    }
  },
  decorate(item, tab) {
    if (tab.mode) return { ...item, rowKey: String(item.key || item.id), rowType: tab.mode === 'following' ? 'PROFILE' : 'ARTICLE', timeLabel: social.timeLabel(item.publishAt || item.createdAt) }
    if (tab.key === 'myComments') return { ...item, rowKey: String(item.id), rowType: 'COMMENT', timeLabel: social.relativeTime(item.createdAt) }
    if (tab.kind) return { ...item, rowKey: String(item.id), rowType: 'NOTICE', timeLabel: social.relativeTime(item.createdAt),
      action: tab.kind === 'LIKE' ? '赞了你的文章' : tab.kind === 'COLLECT' ? '收藏了你的文章' : tab.kind === 'COMMENT' ? '评论了你' : '关注了你' }
    return { ...item, rowKey: item.peer.key, rowType: 'MESSAGE', unreadCount: notices.count(item.unreadCount),
      unreadLabel: notices.label(item.unreadCount), timeLabel: social.timeLabel(item.lastMessage && item.lastMessage.createdAt) }
  },
  onOpen(event) {
    const item = this.data.list.find(row => row.rowKey === String(event.currentTarget.dataset.id))
    if (!item || !social.active(this)) return
    let url
    if (item.rowType === 'ARTICLE') url = `/pages/news-detail/news-detail?id=${item.id}`
    else if (item.rowType === 'PROFILE') url = `/pages/community-profile/community-profile?key=${item.key}`
    else if (item.rowType === 'COMMENT') {
      if (!item.articleAvailable) return wx.showToast({ title: '文章已不可查看', icon: 'none' })
      url = `/pages/news-detail/news-detail?id=${item.newsId}&comments=1&commentId=${item.id}`
    } else if (item.rowType === 'MESSAGE') url = `/pages/messages/messages?peer=${item.peer.userId}`
    else if (item.kind === 'FOLLOW') url = `/pages/community-profile/community-profile?key=${item.actor.key}`
    else {
      const target = item.kind === 'COMMENT' ? '&comments=1' + (/^[1-9]\d{0,18}$/.test(String(item.commentId || '')) ? `&commentId=${item.commentId}` : '') : ''
      url = `/pages/news-detail/news-detail?id=${item.newsId}${target}`
    }
    const token = getToken()
    wx.navigateTo({ url, success: () => {
      // 打开分类不标已读；具体页面打开成功后，仅处理该条互动通知。
      if (item.rowType !== 'NOTICE' || item.read || getToken() !== token) return
      api.readInteractionNotice(item.id).then(() => {
        if (getToken() === token) notices.refresh(true)
      }).catch(error => {
        if (getToken() === token) wx.showToast({ title: error.message || '标记失败，请重试', icon: 'none' })
      })
    }, fail: () => { if (getToken() === token) wx.showToast({ title: '页面打开失败，请重试', icon: 'none' }) } })
  },
  onMore() { return this.load(false) },
  onRetry() { this._busy = false; return this.load(true) },
  onReachBottom() { return this.load(false) },
  async onPullDownRefresh() { try { await this.onRetry(); notices.refresh() } finally { wx.stopPullDownRefresh() } }
})
