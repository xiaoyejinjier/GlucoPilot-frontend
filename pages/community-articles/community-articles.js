const api = require('../../services/api')
const social = require('../../utils/community')
const publication = require('../../utils/publication')
const { applyDisplayToCurrentPage } = require('../../utils/display')
Page({
  data:{ displayStyle:'', articles:[], loading:false, error:'', pageNum:0, hasMore:false, retrying:'', mode:'articles' },
  onLoad(options) { if(options.mode==='drafts')this.setData({mode:'drafts'}) },
  onMode(e) { const mode=e.currentTarget.dataset.mode;if(!['articles','drafts'].includes(mode)||mode===this.data.mode)return;this._run=(this._run||0)+1;this.setData({mode,articles:[],pageNum:0,hasMore:false});this.load(true) },
  onShow() { if (!getApp().checkLogin()) return
    if (this._communityToken && this._communityToken !== require('../../utils/request').getToken()) this.setData({ articles:[], error:'' })
    social.begin(this); applyDisplayToCurrentPage(); this.setData({ retrying:'' }); this.load(true) },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 }, onUnload() { this.onHide() },
  async load(reset) {
    if (!social.active(this) || (!reset && (this.data.loading || !this.data.hasMore))) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1, pageNum = reset ? 1 : this.data.pageNum + 1
    this.setData({ loading:true, error:'' })
    try { const result = await (this.data.mode==='drafts'?api.fetchDrafts({pageNum,pageSize:15}):api.fetchMyArticles({ pageNum, pageSize:15 })); if (!social.active(this,version) || run !== this._run) return
      const rows = result.records.map(article => ({ ...article, title:article.title || '未命名草稿',summary:this.data.mode==='drafts'?article.body:article.summary,tags:article.tags || [],statusInfo:this.data.mode==='drafts'?{label:'草稿',tone:'muted',hint:'仅自己可见，继续编辑后可发布。'}:publication.state(article.state), timeLabel:social.timeLabel(article.updatedAt || article.createdAt) }))
      this.setData({ articles:reset ? rows : [...this.data.articles,...rows], pageNum, hasMore:pageNum < Number(result.pages) })
    } catch (error) { if (social.active(this,version,error) && run === this._run) { this.setData({ error:error.message || '文章加载失败' }); if (error.code === 40100) social.failure(this,error,version) } }
    finally { if (social.active(this,version) && run === this._run) this.setData({ loading:false }) }
  },
  onMore() { this.load(false) }, onRetry() { this.load(true) }, async onPullDownRefresh() { try { await this.load(true) } finally { wx.stopPullDownRefresh() } },
  onWrite() { wx.navigateTo({ url:'/pages/community-compose/community-compose' }) },
  onEdit(e) {
    const id=String(e.currentTarget.dataset.id),token=this._communityToken
    if(!social.active(this)||!this.data.articles.some(row=>String(row.id)===id)||!/^[1-9]\d{0,18}$/.test(id))return
    const drafts=this.data.mode==='drafts'
    wx.navigateTo({url:`/pages/community-compose/community-compose?${drafts?'draft':'id'}=${id}`,events:{draftPublished:result=>{
      if(drafts&&String(result.id)===id&&this.data.mode==='drafts'&&token===require('../../utils/request').getToken()&&token===this._communityToken)
        this.setData({articles:this.data.articles.filter(row=>String(row.id)!==id)})
    }}})
  },
  async onDeleteDraft(e) { if(this.data.mode!=='drafts'||!social.active(this)||this.data.retrying)return;const item=this.data.articles.find(row=>row.id===String(e.currentTarget.dataset.id));if(!item)return;const version=this._communityVersion;const result=await new Promise(resolve=>wx.showModal({title:'删除草稿',content:'删除后无法恢复，确认删除这份草稿吗？',success:resolve,fail:()=>resolve({confirm:false})}));if(!result.confirm||!social.active(this,version))return;this.setData({retrying:item.id});try{await api.deleteDraft(item.id,item.revision);if(social.active(this,version))await this.load(true)}catch(error){social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({retrying:''})} },
  onOpen(e) { const item = this.data.articles.find(article => article.id === String(e.currentTarget.dataset.id)); if (item && item.state === 'PUBLISHED') wx.navigateTo({ url:`/pages/news-detail/news-detail?id=${item.id}` }) },
  async onRetryAi(e) { const id = String(e.currentTarget.dataset.id); if (this.data.retrying || !social.active(this)) return
    const version = this._communityVersion; this.setData({ retrying:id })
    try { await api.retryArticleAi(id); if (social.active(this,version)) { wx.showToast({ title:'已重新提交初审', icon:'none' }); await this.load(true) } }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this.setData({ retrying:'' }) }
  }
})
