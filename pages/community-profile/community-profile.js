const api = require('../../services/api')
const social = require('../../utils/community')
const { applyDisplayToCurrentPage } = require('../../utils/display')
Page({
  data: { displayStyle: '', profile: null, loading: false, busy: false, error: '', articles:[],articlePage:0,articleHasMore:false,articlesLoading:false,articlesError:'' },
  onLoad(options) { this._key = /^[ub][1-9]\d{0,18}$/.test(String(options.key || '')) ? options.key : '' },
  onShow() { if (!getApp().checkLogin()) return; social.begin(this); this._articlesBusy=false; this.setData({ profile: null, busy: false,articles:[],articlePage:0,articleHasMore:false,articlesLoading:false,articlesError:'' }); applyDisplayToCurrentPage(); this.load() },
  onHide() { social.end(this) }, onUnload() { social.end(this) },
  async load() {
    const version = this._communityVersion; this.setData({ loading: true, error: '' })
    try {
      if (!this._key) throw new Error('用户不存在')
      const profile = await api.fetchCommunityProfile(this._key)
      if (social.active(this, version)) {this.setData({ profile });this.loadArticles(true)}
    } catch (error) { if (social.active(this, version, error)) { this.setData({ error: error.message || '资料加载失败' }); social.failure(this, error, version) } }
    finally { if (social.active(this, version)) this.setData({ loading: false }) }
  },
  async loadArticles(reset=false){
    if(!social.active(this)||!this.data.profile||this._articlesBusy||(!reset&&!this.data.articleHasMore))return
    const version=this._communityVersion,pageNum=reset?1:this.data.articlePage+1;this._articlesBusy=true;this.setData({articlesLoading:true,articlesError:''})
    try{const page=await api.fetchProfileArticles(this._key,{pageNum,pageSize:10});if(!social.active(this,version))return
      const all=new Map((reset?[]:this.data.articles).map(a=>[a.id,a]));page.records.forEach(a=>all.set(a.id,{...a,timeLabel:social.relativeTime(a.publishAt)}));this.setData({articles:Array.from(all.values()),articlePage:pageNum,articleHasMore:pageNum<Number(page.pages)})
    }catch(error){if(social.active(this,version,error))this.setData({articlesError:error.message||'内容加载失败，点击重试'})}
    finally{if(social.active(this,version)){this._articlesBusy=false;this.setData({articlesLoading:false})}}
  },
  onMoreArticles(){return this.loadArticles(false)},onRetryArticles(){return this.loadArticles(true)},
  onArticle(e){const id=String(e.currentTarget.dataset.id||'');if(social.active(this)&&this.data.articles.some(a=>String(a.id)===id))wx.navigateTo({url:`/pages/news-detail/news-detail?id=${id}`})},
  async onFollow() {
    if (!social.active(this) || !this.data.profile || this.data.profile.isSelf || this.data.busy) return
    const version = this._communityVersion; this.setData({ busy: true })
    try { const profile = await api.setCommunityFollowing(this._key, !this.data.profile.followed); if (social.active(this, version)) {this.setData({ profile });this.loadArticles(true)} }
    catch (error) { social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ busy: false }) }
  },
  onMessage() {
    const profile = this.data.profile
    if (social.active(this) && profile && profile.userId && !profile.isSelf) wx.navigateTo({ url: `/pages/messages/messages?peer=${profile.userId}` })
  },
  onReport() { const profile = this.data.profile; if (profile && profile.userId && !profile.isSelf && social.active(this)) social.report('USER',profile.userId) },
  onCopyKey() {
    const profile = this.data.profile
    const key = profile && profile.userId ? `u${profile.userId}` : ''
    if (/^u[1-9]\d{0,18}$/.test(key)) wx.setClipboardData({ data: key })
  }
})
