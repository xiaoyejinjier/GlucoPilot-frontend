const api = require('../../services/api')
const { mapField } = require('../../utils/remote-image')
const social = require('../../utils/community')
const { TAGS, reportUrl } = require('../../utils/publication')
const tagHistory = require('../../utils/article-tags')
const customTagCode = require('../../utils/custom-tag-code')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', tags: [], otherTags:[],otherSelected:false,tagsError:'',activeTag: '', feedMode: 'recommend', posts: [],
    loading: false, error: '', pageNum: 0, hasMore: false, searchMounted: false, searchOpen: false },
  onShow() {
    if (!getApp().checkLogin()) return
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tabBar) { tabBar.setData({ selected: 1 }); if (tabBar.refreshGuide) tabBar.refreshGuide() }
    const token = this._communityToken; social.begin(this); applyDisplayToCurrentPage()
    if (token && token !== this._communityToken) this.setData({ posts: [], activeTag: '', feedMode: 'recommend',tags:[],otherTags:[],otherSelected:false })
    this._busy = new Set(); this.load(true)
    this.loadTags()
  },
  async loadTags() {
    const version=this._communityVersion,run=this._tagRun=(this._tagRun||0)+1
    try {
      const [catalog, mine] = await Promise.all([api.fetchCommunityTags(), api.fetchMyCommunityTags(true)])
      if(!social.active(this,version)||run!==this._tagRun)return
      const rows=Array.isArray(catalog)?catalog:[], mineRows=Array.isArray(mine)?mine:[]
      const isUser=t=>t && (t.type==='USER'||String(t.code||'').startsWith('custom_'))
      const unpinned=new Set(tagHistory.unpinned().map(n=>String(n).toLowerCase()))
      const hidden=new Set(tagHistory.hidden().map(n=>String(n).toLowerCase()))
      const tags=rows.filter(t=>!isUser(t)).filter(t=>t.code==='other'||!unpinned.has(String(t.name).toLowerCase()))
      const byCode=new Map(), byName=new Map()
      const put=(t)=>{
        if(!t)return
        const name=String(t.name||'').trim()
        const nameKey=name.toLowerCase()
        if(!name||hidden.has(nameKey))return
        let code=String(t.code||'')
        if(!code) code=customTagCode.fromName(name)
        if(!code||byCode.has(code))return
        const row={ code, name, type:'USER', enabled: t.enabled == null ? 1 : t.enabled }
        byCode.set(code, row)
        byName.set(nameKey, row)
      }
      ;[...rows.filter(isUser), ...mineRows.filter(t=>isUser(t) && t.enabled!==0)].forEach(put)
      tagHistory.list().forEach(name=>{
        const key=String(name).toLowerCase()
        if(hidden.has(key)||byName.has(key))return
        put({ name, code: customTagCode.fromName(name), type:'USER', enabled:1 })
      })
      const otherTags=Array.from(byCode.values())
      const removed=!!(this.data.activeTag&&this.data.activeTag!=='other'&&!(
        tags.some(t=>t.code===this.data.activeTag)||
        otherTags.some(t=>t.code===this.data.activeTag)
      ))
      this.setData({tags,otherTags,tagsError:'',...(removed?{activeTag:'',otherSelected:false}: {})})
      if(removed)this.load(true)
    }catch(error){if(social.active(this,version)&&run===this._tagRun)this.setData({tagsError:'标签加载失败，点击重试'})}
  },
  onHide() { social.end(this); this._loadRun = (this._loadRun || 0) + 1 },
  onUnload() { this.onHide() },
  openMyTags() {
    if (!social.active(this)) return
    const version = this._communityVersion
    wx.navigateTo({
      url: '/pages/community-tags/community-tags?mode=browse',
      events: {
        filterTag: detail => {
          if (!social.active(this, version)) return
          const code = detail && detail.code ? String(detail.code) : 'other'
          this.setData({ activeTag:code, otherSelected:code === 'other', posts:[] }); this.load(true)
        }
      }
    })
  },
  async load(reset) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._loadRun = (this._loadRun || 0) + 1
    const pageNum = reset ? 1 : this.data.pageNum + 1
    this.setData({ loading: true, error: '' })
    try {
      const hot = this.data.feedMode === 'hot'
      const page = hot
        ? await api.fetchHotArticles({ limit: 10 })
        : await api.fetchCommunityArticles({ pageNum, pageSize: 15, tag: this.data.activeTag,
            following: this.data.feedMode === 'following',
            sort: this.data.feedMode === 'following' ? 'LATEST' : 'RECOMMEND' })
      if (!social.active(this, version) || run !== this._loadRun) return
      const records = (await mapField(page.records || [], 'cover')).map((post, index) => ({
        ...post,
        images: post.images || [],
        videos: post.videos || [],
        tags: post.tags || [],
        timeLabel: social.timeLabel(post.publishAt || post.createdAt),
        hotRank: hot ? index + 1 : 0
      }))
      if (!social.active(this, version) || run !== this._loadRun) return
      const map = new Map((reset || hot ? [] : this.data.posts).map(post => [post.id, post])); records.forEach(post => map.set(post.id, post))
      this.setData({ posts: Array.from(map.values()), pageNum: hot ? 1 : pageNum, hasMore: hot ? false : pageNum < Number(page.pages), loading: false })
    } catch (error) {
      if (!social.active(this, version, error) || run !== this._loadRun) return
      this.setData({ loading: false, error: error.message || '社区加载失败，请重试', ...(reset ? { posts: [], hasMore: false } : {}) })
      if (error.code === 40100) social.failure(this, error, version)
    }
  },
  onMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!['recommend','following','hot'].includes(mode) || mode === this.data.feedMode) return
    this.setData({
      feedMode: mode,
      posts: [],
      ...(mode === 'hot' ? { activeTag: '', otherSelected: false } : {})
    })
    this.load(true)
  },
  onTag(e) {
    const code = e.currentTarget.dataset.code || ''
    if (code === '__manage__') return this.openMyTags()
    if (code === this.data.activeTag) return
    this.setData({ activeTag: code, otherSelected: code === 'other', posts: [], ...(this.data.feedMode === 'hot' ? { feedMode: 'recommend' } : {}) })
    this.load(true)
  },
  onOpenSearch() {
    if (!social.active(this)) return
    this._searchCloseTimer && clearTimeout(this._searchCloseTimer)
    this.setData({ searchMounted: true, searchOpen: false })
    const defer = typeof wx.nextTick === 'function' ? wx.nextTick : (fn) => setTimeout(fn, 16)
    defer(() => this.setData({ searchOpen: true }))
  },
  onCloseSearch() {
    if (!this.data.searchMounted) return
    this.setData({ searchOpen: false })
    this._searchCloseTimer && clearTimeout(this._searchCloseTimer)
    this._searchCloseTimer = setTimeout(() => {
      if (!this.data.searchOpen) this.setData({ searchMounted: false })
    }, 240)
  },
  onSearchOverlayTouchMove() {},
  onRetry() { this.load(true) },
  onMore() { this.load(false) },
  onReachBottom() { this.load(false) },
  async onPullDownRefresh() { try { await Promise.all([this.loadTags(),this.load(true)]) } finally { wx.stopPullDownRefresh() } },
  onWrite() { wx.navigateTo({ url: '/pages/community-compose/community-compose' }) },
  onMyArticles() { wx.navigateTo({ url: '/pages/community-articles/community-articles' }) },
  onOpen(e) { const id = String(e.currentTarget.dataset.id || ''); if (/^[1-9]\d{0,18}$/.test(id)) wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${id}` }) },
  onComments(e) { const id = String(e.currentTarget.dataset.id || ''); if (/^[1-9]\d{0,18}$/.test(id)) wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${id}&comments=1` }) },
  onProfile(e) { const key = e.currentTarget.dataset.key; if (/^[ub][1-9]\d{0,18}$/.test(String(key || ''))) wx.navigateTo({ url: `/pages/community-profile/community-profile?key=${key}` }) },
  onCommunityEntry(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === 'messages') { wx.navigateTo({ url: '/pages/information/information' }); return }
    if (['following','likes','collections','profiles'].includes(mode)) wx.navigateTo({ url: `/pages/community/community?mode=${mode}` })
  },
  onReport(e) {
    const id=String(e.currentTarget.dataset.id),post=this.data.posts.find(row=>String(row.id)===id)
    if(!post||!social.active(this))return
    const version=this._communityVersion
    wx.showActionSheet({itemList:['举报','减少此类内容'],success:result=>{if(!social.active(this,version))return;if(result.tapIndex===0){const url=reportUrl('ARTICLE',id);if(url)wx.navigateTo({url})}else if(result.tapIndex===1)this.onHideArticle(id,version)}})
  },
  async onHideArticle(id,version=this._communityVersion){if(!social.active(this,version))return;if(!this._busy)this._busy=new Set();const key='hide:'+id;if(this._busy.has(key))return;this._busy.add(key);try{await api.hideCommunityArticle(id);if(social.active(this,version)){this._loadRun=(this._loadRun||0)+1;this.setData({posts:this.data.posts.filter(row=>String(row.id)!==id),loading:false});wx.showToast({title:'将减少此类内容，该文章已隐藏',icon:'none'})}}catch(error){social.failure(this,error,version)}finally{if(social.active(this,version))this._busy.delete(key)}},
  async onAction(e) {
    const id = String(e.currentTarget.dataset.id), field = e.currentTarget.dataset.field
    const post = this.data.posts.find(item => String(item.id) === id)
    if (!post || !['liked','collected'].includes(field) || !social.active(this)) return
    if (!this._busy) this._busy = new Set()
    if (this._busy.has(id)) return
    this._busy.add(id); const version = this._communityVersion
    try {
      const result = await api.updateNewsAction(id,{ [field]: !post[field] })
      if (social.active(this,version)) {
        this.setData({ posts: this.data.posts.map(item => String(item.id) === id ? { ...item, ...result, [field+'Pulse']:(item[field+'Pulse']||0)+1 } : item) })
        social.success(this,field,!!result[field])
      }
    }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this._busy.delete(id) }
  },
  async onFollow(e) {
    const key = e.currentTarget.dataset.key, post = this.data.posts.find(item => item.author && item.author.key === key)
    if (!post || post.author.isSelf || !social.active(this)) return
    if (!this._busy) this._busy = new Set()
    const busy = `follow:${key}`; if (this._busy.has(busy)) return
    this._busy.add(busy); const version = this._communityVersion
    try {
      const profile = await api.setCommunityFollowing(key,!post.author.followed)
      if (social.active(this,version)) {
        this.setData({ posts: this.data.posts.map(item => item.author && item.author.key === key ? { ...item, author: profile } : item) })
        social.success(this,'followed',!!profile.followed)
      }
    }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this._busy.delete(busy) }
  }
})
