const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')
const { loadRemoteImage } = require('../../utils/remote-image')
const social = require('../../utils/community')
const { getToken } = require('../../utils/request')

function decorateComment(comment) {
  return { ...comment, id:String(comment.id), rootCommentId:comment.rootCommentId ? String(comment.rootCommentId) : String(comment.id), replyToCommentId:comment.replyToCommentId ? String(comment.replyToCommentId) : null, avatarText:Array.from(String(comment.author && comment.author.nickname || '糖友'))[0],
    timeLabel:social.relativeTime(comment.createdAt), replies:(comment.replies || []).map(decorateComment), replyCount:Number(comment.replyCount || 0) }
}

Page({
  data: { displayStyle: '', news: null, loading: true, error: '', liked: false, collected: false, likedPulse:0,collectedPulse:0,
    actionBusy: false, comments: [], commentPage: 0, commentHasMore: false, commentsLoading: false,
    commentsError: '', commentDraft: '', posting: false, followBusy: false, replyTarget:null, commentFocus:false,
    highlightedCommentId:'', commentTargetLoading:false, commentTargetError:'' },
  onLoad(options) {
    this._newsId = /^[1-9]\d{0,18}$/.test(String(options.id || '')) ? String(options.id) : ''
    this._targetCommentId = /^[1-9]\d{0,18}$/.test(String(options.commentId || '')) ? String(options.commentId) : ''
    this._jumpCommentPending = !!this._targetCommentId
    this._jumpToComments = options.comments === '1' && !this._targetCommentId
  },
  onShow() {
    if (!getApp().checkLogin()) return
    if (this._communityToken && this._communityToken !== getToken()) {
      this._commentAttempt = null
      this.setData({ news: null, comments: [], commentDraft: '', liked: false, collected: false, replyTarget:null, commentFocus:false })
    }
    social.begin(this); this._actionBusy = this._commentsBusy = false
    this._targetBusy = false; this._targetRun = (this._targetRun || 0) + 1
    this.setData({ highlightedCommentId:'', commentTargetLoading:false, commentTargetError:'' })
    this._repliesBusy = new Set()
    if (this._commentClock) clearInterval(this._commentClock)
    this._commentClock = setInterval(() => { if (social.active(this) && this.data.comments.length) this.setData({ comments:this.data.comments.map(decorateComment) }) },60000)
    this.setData({ actionBusy: false, posting: false, commentsLoading: false, followBusy: false, comments:this.data.comments.map(comment => ({ ...comment, repliesLoading:false })) })
    applyDisplayToCurrentPage(); this.loadDetail(); this.loadComments(true)
  },
  onHide() { if (this._commentClock) clearInterval(this._commentClock); this._commentClock = null; social.end(this) },
  onUnload() { this.onHide() },
  async loadDetail() {
    const version = this._communityVersion, run = this._detailRun = (this._detailRun || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      if (!this._newsId) throw new Error('文章不存在')
      const news = await api.fetchNewsDetail(this._newsId)
      if (!social.active(this, version) || run !== this._detailRun) return
      this.setData({ news, liked: !!news.liked, collected: !!news.collected, loading: false }, () => {
        if (!social.active(this, version) || run !== this._detailRun) return
        this.scrollToCommentTarget()
        if (!this._jumpToComments || this._jumpCommentPending) return
        const scroll = () => { if (this._jumpToComments && social.active(this, version) && run === this._detailRun) this.onComments() }
        if (typeof wx.nextTick === 'function') wx.nextTick(scroll)
        else scroll()
      })
      if(typeof api.recordArticleView==='function')api.recordArticleView(this._newsId).then(result=>{if(social.active(this,version)&&run===this._detailRun)this.setData({'news.viewCount':result.viewCount})}).catch(()=>{})
      if (news.title) wx.setNavigationBarTitle({ title: news.title })
      // The comment anchor is ready without waiting for a potentially slow cover download.
      try {
        const cover = await loadRemoteImage(news.cover)
        if (social.active(this,version) && run === this._detailRun) this.setData({ 'news.cover':cover })
      } catch (_) { /* Keep the article and comments available when its cover is unavailable. */ }
    } catch (error) {
      if (!social.active(this, version, error) || run !== this._detailRun) return
      this.setData({ loading: false, error: error.message || '文章加载失败，点击重试',...((error.code===40400||error.statusCode===404)?{news:null,comments:[]}:{} ) }); social.failure(this, error, version)
    }
  },
  onLike() { return this.updateAction('liked') },
  onCollect() { return this.updateAction('collected') },
  onComments() {
    if (!this.data.news || !social.active(this)) return
    this._jumpCommentPending = false
    const version = this._communityVersion
    wx.pageScrollTo({ selector:'#article-comments', duration:260, success:() => {
      if (social.active(this,version)) this._jumpToComments = false
    } })
  },
  onReport() { if (this.data.news && social.active(this)) social.report('ARTICLE',this._newsId) },
  onReportComment(e) { const comment = this.findComment(e.currentTarget.dataset.id); if (comment && !comment.mine && social.active(this)) social.report('COMMENT',comment.id) },
  findComment(id) { return this.data.comments.flatMap(comment => [comment,...(comment.replies || [])]).find(comment => comment.id === String(id)) },
  async loadCommentTarget() {
    if (!this._targetCommentId || !social.active(this) || this._targetBusy) return
    this._targetBusy = true
    const version = this._communityVersion, run = this._targetRun = (this._targetRun || 0) + 1
    this.setData({ commentTargetLoading:true, commentTargetError:'' })
    try {
      const context = await api.fetchCommentContext(this._newsId,this._targetCommentId)
      if (!social.active(this,version) || run !== this._targetRun) return
      if (!context || String(context.commentId) !== this._targetCommentId || !context.root) throw new Error('invalid comment context')
      const root = decorateComment(context.root)
      if (root.id !== this._targetCommentId && !root.replies.some(reply => reply.id === this._targetCommentId)) throw new Error('missing target comment')
      const old = this.data.comments.find(item => item.id === root.id)
      if (old) {
        const replies = new Map((old.replies || []).map(reply => [reply.id,reply]));root.replies.forEach(reply => replies.set(reply.id,reply));root.replies = Array.from(replies.values()).sort(social.compareId)
      }
      this.setData({ comments:[root,...this.data.comments.filter(item => item.id !== root.id)], highlightedCommentId:this._targetCommentId }, () => this.scrollToCommentTarget())
    } catch (error) {
      if (!social.active(this,version,error) || run !== this._targetRun) return
      const missing = error.code === 40400 || error.statusCode === 404
      this.setData({ commentTargetError:missing ? '该评论已删除或暂不可见' : '评论定位失败，点击重试' })
      if (this._jumpCommentPending) { this._jumpToComments = true; this._jumpCommentPending = false; this.onComments() }
    } finally { if (social.active(this,version) && run === this._targetRun) { this._targetBusy = false; this.setData({ commentTargetLoading:false }) } }
  },
  onRetryCommentTarget() { this._jumpCommentPending = true; return this.loadCommentTarget() },
  scrollToCommentTarget() {
    if (!this._jumpCommentPending || !this.data.news || !social.active(this) || this.data.highlightedCommentId !== this._targetCommentId || !this.findComment(this._targetCommentId)) return
    const version = this._communityVersion, target = this._targetCommentId
    const scroll = () => {
      if (!this._jumpCommentPending || !social.active(this,version)) return
      wx.pageScrollTo({ selector:'#comment-'+target, duration:260, success:() => {
        if (social.active(this,version)) { this._jumpCommentPending = false; this._jumpToComments = false }
      } })
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(scroll); else scroll()
  },
  onCommentAvatarError(e) {
    const id = String(e.currentTarget.dataset.id)
    this.setData({ comments:this.data.comments.map(root => ({ ...root, ...(root.id === id ? { avatarFailed:true } : {}), replies:(root.replies || []).map(reply => reply.id === id ? { ...reply, avatarFailed:true } : reply) })) })
  },
  onReply(e) {
    const comment = this.findComment(e.currentTarget.dataset.id)
    if (!comment || !this.data.news || this.data.posting || !social.active(this)) return
    const version = this._communityVersion
    this.setData({ replyTarget:{ id:comment.id, rootId:comment.rootCommentId || comment.id, key:comment.author && comment.author.key || '', nickname:comment.author && comment.author.nickname || '糖友' }, commentFocus:false })
    wx.pageScrollTo({ selector:'#comment-composer', duration:200, complete:() => { if (social.active(this,version)) this.setData({ commentFocus:true }) } })
  },
  onCancelReply() { if (this.data.posting) return; this._commentAttempt = null; this.setData({ replyTarget:null, commentFocus:false }) },
  onCommentBlur() { this.setData({ commentFocus:false }) },
  async onFollowAuthor() {
    const author = this.data.news && this.data.news.author
    if (!author || author.isSelf || this.data.followBusy || !social.active(this)) return
    const version = this._communityVersion; this.setData({ followBusy:true })
    try {
      const result = await api.setCommunityFollowing(author.key,!author.followed)
      if (social.active(this,version)) { this.setData({ 'news.author':result }); social.success(this,'followed',!!result.followed) }
    }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this.setData({ followBusy:false }) }
  },
  async updateAction(field) {
    if (!social.active(this) || !this.data.news || this.data.loading || this._actionBusy) return
    this._actionBusy = true; this.setData({ actionBusy: true })
    const version = this._communityVersion
    try {
      const result = await api.updateNewsAction(this._newsId, { [field]: !this.data[field] })
      if (!social.active(this, version)) return
      this.setData({ liked: result.liked, collected: result.collected,
        'news.likeCount': result.likeCount, 'news.collectCount': result.collectCount, [field+'Pulse']:(this.data[field+'Pulse']||0)+1 })
      social.success(this,field,!!result[field])
    } catch (error) { social.failure(this, error, version) }
    finally { if (social.active(this, version)) { this._actionBusy = false; this.setData({ actionBusy: false }) } }
  },
  async loadComments(reset) {
    if (!social.active(this) || !this._newsId || this._commentsBusy || (!reset && !this.data.commentHasMore)) return
    this._commentsBusy = true
    const version = this._communityVersion, pageNum = reset ? 1 : this.data.commentPage + 1
    this.setData({ commentsLoading: true, commentsError: '' })
    try {
      const page = await api.fetchNewsComments(this._newsId, { pageNum, pageSize: 20 })
      if (!social.active(this, version)) return
      const incoming = page.records.map(decorateComment)
      const map = new Map((reset ? [] : this.data.comments).map(item => [item.id, item]))
      incoming.forEach(item => {
        const old = map.get(item.id)
        if (old && this._targetCommentId && (old.replies || []).some(reply => reply.id === this._targetCommentId)) {
          const replies = new Map(old.replies.map(reply => [reply.id,reply]));item.replies.forEach(reply => replies.set(reply.id,reply));item.replies = Array.from(replies.values()).sort(social.compareId)
        }
        map.set(item.id, item)
      })
      this.setData({ comments: Array.from(map.values()), commentPage: pageNum, commentHasMore: pageNum < Number(page.pages) })
    } catch (error) {
      if (social.active(this, version, error)) { this.setData({ commentsError: '评论加载失败，点击重试' }); social.failure(this, error, version) }
    } finally { if (social.active(this, version)) { this._commentsBusy = false; this.setData({ commentsLoading: false }) } }
    if (reset && this._targetCommentId && social.active(this,version)) return this.loadCommentTarget()
  },
  onMoreComments() { return this.loadComments(false) },
  onRetryComments() { return this.loadComments(true) },
  async onMoreReplies(e) {
    const id = String(e.currentTarget.dataset.id), root = this.data.comments.find(comment => comment.id === id)
    if (!root || !root.replyHasMore || !social.active(this) || this._repliesBusy.has(id)) return
    const version = this._communityVersion; this._repliesBusy.add(id)
    this.setData({ comments:this.data.comments.map(comment => comment.id === id ? { ...comment, repliesLoading:true, repliesError:'' } : comment) })
    try {
      const page = await api.fetchCommentReplies(this._newsId,id,{ ...(root.replyNextAfterId ? { afterId:root.replyNextAfterId } : {}), pageSize:10 })
      if (!social.active(this,version)) return
      this.setData({ comments:this.data.comments.map(comment => {
        if (comment.id !== id) return comment
        const replies = new Map((comment.replies || []).map(reply => [reply.id,reply])); page.records.forEach(reply => replies.set(reply.id,decorateComment(reply)))
        return { ...comment, replies:Array.from(replies.values()).sort(social.compareId), replyCount:Math.max(comment.replyCount,replies.size), replyHasMore:!!page.hasMore, replyNextAfterId:page.nextAfterId, repliesLoading:false }
      }) })
    } catch (error) {
      if (social.active(this,version,error)) { this.setData({ comments:this.data.comments.map(comment => comment.id === id ? { ...comment, repliesLoading:false, repliesError:'回复加载失败，点击重试' } : comment) }); social.failure(this,error,version) }
    } finally { if (social.active(this,version)) this._repliesBusy.delete(id) }
  },
  onCommentInput(event) { this.setData({ commentDraft: event.detail.value }) },
  async onCommentSend() {
    const content = this.data.commentDraft.trim()
    if (!social.active(this) || !this.data.news || this.data.posting || !content) return
    if (content.length > 500) { wx.showToast({ title: '评论最多500字', icon: 'none' }); return }
    const targetId = this.data.replyTarget && this.data.replyTarget.id || undefined
    if (!this._commentAttempt || this._commentAttempt.content !== content || this._commentAttempt.replyToCommentId !== targetId) this._commentAttempt = { content, ...(targetId ? { replyToCommentId:targetId } : {}), clientRequestId: social.requestId() }
    const payload = this._commentAttempt, version = this._communityVersion
    this.setData({ posting: true })
    try {
      const saved = await api.addNewsComment(this._newsId, payload)
      if (!social.active(this, version)) return
      if (targetId && (!saved || String(saved.replyToCommentId) !== String(targetId))) throw new Error('回复结果异常，请刷新评论确认后重试')
      this._commentAttempt = null; this.setData({ commentDraft: '', replyTarget:null, commentFocus:false })
      social.success(this,targetId ? 'reply' : 'comment')
      const root = saved && saved.replyToCommentId && this.data.comments.find(comment => comment.id === String(saved.rootCommentId))
      if (root && saved.id) {
        const replies = new Map((root.replies || []).map(reply => [reply.id,reply])), existed = replies.has(saved.id)
        replies.set(saved.id,decorateComment(saved))
        const updated = { ...root, replies:Array.from(replies.values()).sort(social.compareId), replyCount:root.replyCount + (existed ? 0 : 1), repliesError:'' }
        if (!root.replyHasMore) updated.replyNextAfterId = updated.replies[updated.replies.length - 1].id
        this.setData({ comments:this.data.comments.map(comment => comment.id === root.id ? updated : comment) })
      } else await this.loadComments(true)
      this.loadDetail()
    } catch (error) { social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ posting: false }) }
  },
  onProfile(event) {
    const key = event.currentTarget.dataset.key
    if (/^[ub][1-9]\d{0,18}$/.test(String(key || ''))) wx.navigateTo({ url: `/pages/community-profile/community-profile?key=${key}` })
  },
  onDeleteComment(event) {
    const item = this.findComment(event.currentTarget.dataset.id)
    if (!item || !item.mine || !social.active(this)) return
    const version = this._communityVersion
    wx.showModal({ title: '删除评论', content: '确定删除这条评论吗？', success: async result => {
      if (!result.confirm || !social.active(this, version)) return
      try { await api.deleteNewsComment(this._newsId, item.id); if (social.active(this, version)) { if (this.data.replyTarget && (this.data.replyTarget.id === item.id || this.data.replyTarget.rootId === item.id)) this.onCancelReply(); this.loadComments(true); this.loadDetail() } }
      catch (error) { social.failure(this, error, version) }
    } })
  }
})
