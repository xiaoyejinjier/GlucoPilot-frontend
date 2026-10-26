const api = require('../../services/api')
const social = require('../../utils/community')
const publication = require('../../utils/publication')
const tagHistory = require('../../utils/article-tags')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { uploadMediaFile, BIZ_TYPE, MAX_IMAGE_BYTES } = require('../../utils/media')
const { getToken } = require('../../utils/request')
Page({
  data: { displayStyle:'', title:'', body:'', tags:[],otherTags:[],tagsLoading:false,tagsError:'',tagNotice:'', tagCodes:[], selectedTags:[], customTags:[], customTagInput:'', tagCount:0, posting:false,
    visibility:'PUBLIC',viewerIds:[],visibilityLabel:'公开',visibilityOpen:false,loading:false, loadError:'', editing:false, submitted:null, statusInfo:null, revision:null, originalState:'', images:[], videos:[], recentTags:[], uploading:false, savingDraft:false,draftSaved:false,leaveGuardActive:false },
  onLoad(options) { this._id = /^[1-9]\d{0,18}$/.test(String(options.id || '')) ? String(options.id) : ''; this._draftId = /^[1-9]\d{0,18}$/.test(String(options.draft || '')) ? String(options.draft) : ''; this.captureSavedEditor() },
  onShow() {
    if (!getApp().checkLogin()) return
    if (this._communityToken && this._communityToken !== require('../../utils/request').getToken()) {
      this._tagOptions=[];this._tagsReady=false;this._disabledTagNames=[];this._attempt = this._saveAttempt = this._draftPublishAttempt = null; this._loaded = false; this._savedSnapshot = null; this._savedHadContent = false; this._uploadRun = (this._uploadRun || 0) + 1; this.setData({ title:'', body:'', tagCodes:[], selectedTags:[], customTags:[], customTagInput:'', tagCount:0, submitted:null, images:[], videos:[], recentTags:[], uploading:false,draftSaved:false,visibility:'PUBLIC',viewerIds:[],visibilityLabel:'公开',visibilityOpen:false })
    }
    this._leaving = false; this._leavePrompt = false
    social.begin(this); applyDisplayToCurrentPage(); this.setData({ posting:false }); this.setTags(this.data.tagCodes)
    if(this._savedSnapshot == null)this.captureSavedEditor()
    const version=this._communityVersion
    this.syncEditorState(); this.loadTagOptions().then(()=>{if(social.active(this,version)&&(this._id||this._draftId)&&!this._loaded)this.load()})
  },
  onHide() { this.setData({visibilityOpen:false});social.end(this) }, onUnload() { this._disposed = true; this._leaving = true; this._uploadRun = (this._uploadRun || 0) + 1; social.end(this) },
  editorSnapshot() {
    const content=this.draftContent()
    return JSON.stringify({...content,tagCodes:[...content.tagCodes].sort(),customTags:[...content.customTags].sort(),customTagInput:this.data.customTagInput.trim()})
  },
  hasEditorContent(){return !!(this.data.title.trim()||this.data.body.trim()||this.data.images.length||this.data.videos.length||this.data.tagCodes.length||this.data.customTags.length||this.data.customTagInput.trim())},
  captureSavedEditor(snapshot=this.editorSnapshot(),hadContent=this.hasEditorContent()) {this._savedSnapshot=snapshot;this._savedHadContent=hadContent},
  hasUnsavedContent(){return !this.data.submitted&&(this.hasEditorContent()||this._savedHadContent)&&this.editorSnapshot()!==this._savedSnapshot},
  syncEditorState(){
    const dirty=this.hasUnsavedContent()
    this.setData({draftSaved:!!this._draftId&&!dirty&&!this.data.submitted})
    if(!social.active(this)||this._leaving||this._leavePrompt||this._guardClosing)return
    const needed=!this.data.submitted&&!this.data.loading&&(dirty||this.data.posting||this.data.uploading)
    if(needed&&!this.data.leaveGuardActive)this.setData({leaveGuardActive:true})
    else if(!needed&&this.data.leaveGuardActive){this._guardCloseMode='sync';this._guardClosing=true;this.setData({leaveGuardActive:false})}
  },
  onGuardBeforeLeave(){this._guardClosing=true;if(!this._guardCloseMode)this._guardCloseMode='back'},
  onGuardAfterLeave(){
    const mode=this._guardCloseMode||'back';this._guardCloseMode=null;this._guardClosing=false
    this.setData({leaveGuardActive:false})
    if(mode==='navigate'){const action=this._navigationAction;this._navigationAction=null;if(action&&social.active(this))action();return}
    if(mode==='sync'){this.syncEditorState();return}
    this.requestLeave()
  },
  navigateWithoutGuard(action){
    if(!social.active(this))return
    this._leaving=true
    if(this.data.leaveGuardActive||this._guardClosing){this._guardCloseMode='navigate';this._guardClosing=true;this._navigationAction=action;this.setData({leaveGuardActive:false})}
    else action()
  },
  restoreAfterNavigationFailure(){this._leaving=false;this._navigationAction=null;this.syncEditorState()},
  returnFromEditor(){this.navigateWithoutGuard(()=>wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/index/index',fail:()=>this.restoreAfterNavigationFailure()})}))},
  requestLeave(){
    if(!social.active(this)||this._leavePrompt||this._leaving)return
    if(this.data.posting||this.data.uploading){wx.showToast({title:this.data.uploading?'正在上传，请稍候':'正在保存，请稍候',icon:'none'});this.syncEditorState();return}
    if(!this.hasUnsavedContent())return this.returnFromEditor()
    const version=this._communityVersion;this._leavePrompt=true
    wx.showModal({title:'离开编辑',content:'内容尚未保存，要先存为草稿吗？',cancelText:'确定返回',confirmText:'存草稿',confirmColor:'#308b5b',success:async result=>{
      if(!social.active(this,version))return
      if(result.confirm){
        const saved=await this.onSaveDraft()
        if(!social.active(this,version))return
        this._leavePrompt=false
        if(saved&&!this.hasUnsavedContent())this.returnFromEditor();else this.syncEditorState()
      }else if(result.cancel){this._leavePrompt=false;this.returnFromEditor()}
      else{this._leavePrompt=false;this.syncEditorState()}
    },fail:()=>{if(social.active(this,version)){this._leavePrompt=false;this.syncEditorState()}}})
  },
  notifyDraftPublished(id){
    if(!id||typeof this.getOpenerEventChannel!=='function')return
    try{const channel=this.getOpenerEventChannel();if(channel&&typeof channel.emit==='function')channel.emit('draftPublished',{id:String(id)})}catch(_){/* The opener can already be gone; its next server refresh remains authoritative. */}
  },
  async loadTagOptions() {
    if(!social.active(this))return
    const version=this._communityVersion,run=this._tagsRun=(this._tagsRun||0)+1
    this.setData({tagsLoading:true,tagsError:''})
    try {
      const [catalog,mine]=await Promise.all([api.fetchCommunityTags(),api.fetchMyCommunityTags(true)])
      if(!social.active(this,version)||run!==this._tagsRun)return
      if(!Array.isArray(catalog)||!Array.isArray(mine))throw Error('标签加载失败，点击重试')
      this._disabledTagNames=mine.filter(t=>t.enabled===0).map(t=>t.name)
      tagHistory.forget(this._disabledTagNames)
      const choices=new Map(catalog.filter(t=>t.enabled!==0).map(t=>[t.code,t]))
      mine.filter(t=>t.enabled!==0).forEach(t=>{if(String(t.code).startsWith('custom_')||t.type==='USER')choices.set(t.code,t)})
      this._tagOptions=Array.from(choices.values());this._tagsReady=true
      tagHistory.remember(mine.filter(t=>t.enabled!==0).map(t=>t.name))
      this.setData({tagsLoading:false,tagsError:''});this.setTags(this.data.tagCodes)
    }catch(error){if(social.active(this,version)&&run===this._tagsRun){this._tagsReady=false;this._tagOptions=[];this.setData({tags:[],otherTags:[],tagsLoading:false,tagsError:'标签加载失败，点击重试'})}}
  },
  loadRecentTags(){return this.loadTagOptions()},
  onRecentTag(e) {this.onCustomTagInput({detail:{value:e.currentTarget.dataset.name}});this.onAddCustomTag()},
  async load() {
    const version = this._communityVersion; this.setData({ loading:true, loadError:'' })
    try {
      if(this._draftId) {
        const draft = await api.fetchDraft(this._draftId)
        if(!social.active(this,version))return
        this._id = draft.sourceArticleId || ''; this._draftRevision = draft.revision; this._loaded = true
        this.setData({visibility:draft.visibility||'PUBLIC',viewerIds:draft.viewerIds||[],visibilityLabel:this.visibilityText(draft.visibility),title:draft.title,body:draft.body,videos:draft.videos || [],images:draft.images || [],customTags:draft.customTags || [],revision:draft.sourceRevision,editing:!!this._id,draftSaved:true})
        this.setTags(draft.tagCodes || []); this.captureSavedEditor();this.syncEditorState();return
      }
      const article = await api.fetchCommunityArticle(this._id)
      if (!social.active(this,version)) return
      if (!article.mine) throw new Error('只能编辑自己的文章')
      this._loaded = true; this.setData({visibility:article.visibility||'PUBLIC',viewerIds:article.viewerIds||[],visibilityLabel:this.visibilityText(article.visibility), title:article.title, body:article.body, revision:article.revision, editing:true, originalState:article.state, videos:article.videos || [],images:article.images || [] })
      const builtins = new Set((this._tagOptions||[]).filter(tag=>!String(tag.code).startsWith('custom_')&&tag.type!=='USER').map(tag=>tag.code))
      this.setData({ customTags:article.tags.filter(tag => !builtins.has(tag.code)).map(tag => tag.name) })
      this.setTags(article.tags.filter(tag => builtins.has(tag.code)).map(tag => tag.code));this.captureSavedEditor();this.syncEditorState()
    } catch (error) { if (social.active(this,version,error)) { this.setData({ loadError:error.message || '文章加载失败' }); social.failure(this,error,version) } }
    finally { if (social.active(this,version)) {this.setData({ loading:false });this.syncEditorState()} }
  },
  visibilityText(mode){return mode==='PRIVATE'?'仅自己可见':mode==='FRIENDS'?'指定好友可见':'公开'},
  onVisibility(){if(social.active(this)&&!this.data.posting&&!this.data.uploading&&!this.data.loading)this.setData({visibilityOpen:true})},
  onVisibilityClose(){this.setData({visibilityOpen:false})},
  onVisibilityConfirm(event){if(!social.active(this)||this.data.posting)return;const {visibility,viewerIds}=event.detail;this.setData({visibility,viewerIds,visibilityLabel:this.visibilityText(visibility),visibilityOpen:false});this.syncEditorState()},
  onTitle(e) { this.setData({ title:e.detail.value });this.syncEditorState() }, onBody(e) { this.setData({ body:e.detail.value });this.syncEditorState() },
  draftContent() { return { visibility:this.data.visibility,viewerIds:[...(this.data.viewerIds||[])].sort(),title:this.data.title.trim(),body:this.data.body,tagCodes:this.data.tagCodes,customTags:this.data.customTags,videoMediaIds:this.data.videos.map(video=>video.mediaId),imageMediaIds:this.data.images.map(image=>image.mediaId),sourceArticleId:this._id || null,sourceRevision:this._id ? this.data.revision : null } },
  async persistDraft(version) {
    const snapshot=this.editorSnapshot(),hadContent=this.hasEditorContent()
    const content = this.draftContent(), fingerprint = JSON.stringify({...content,revision:this._draftId?this._draftRevision:null})
    if(!this._saveAttempt || this._saveAttempt.fingerprint !== fingerprint)this._saveAttempt={fingerprint,payload:{...content,revision:this._draftId?this._draftRevision:null,clientRequestId:social.requestId()}}
    const saved = this._draftId ? await api.updateDraft(this._draftId,this._saveAttempt.payload) : await api.createDraft(this._saveAttempt.payload)
    if(!social.active(this,version))return null
    this._draftId=String(saved.id);this._draftRevision=saved.revision;this._loaded=true;this._saveAttempt=null;this.captureSavedEditor(snapshot,hadContent);this.syncEditorState();return saved
  },
  async onSaveDraft() {
    if(this.data.tagsLoading||!this._tagsReady){wx.showToast({title:'请先加载标签后再选择',icon:'none'});return false}
    if(!social.active(this)||this.data.posting||this.data.uploading||this.data.loading||this.data.loadError||this.data.submitted)return
    if(!this.hasEditorContent())return wx.showToast({title:'先写一点内容再保存吧',icon:'none'})
    if(this.data.customTagInput.trim()){this.onAddCustomTag();if(this.data.customTagInput.trim())return}
    const version=this._communityVersion;this.setData({posting:true,savingDraft:true});this.syncEditorState()
    try{const saved=await this.persistDraft(version);if(saved)wx.showToast({title:'已存入草稿箱',icon:'success'});return saved}catch(error){social.failure(this,error,version);return null}finally{if(social.active(this,version)){this.setData({posting:false,savingDraft:false});this.syncEditorState()}}
  },
  onDraftBox() { if(!this.data.posting&&!this.data.uploading)this.navigateWithoutGuard(()=>wx.navigateTo({url:'/pages/community-articles/community-articles?mode=drafts',fail:()=>this.restoreAfterNavigationFailure()})) },
  async onAddImage() {
    if (!social.active(this) || this.data.posting || this.data.uploading || this.data.loading || this.data.loadError || this.data.images.length >= 6) return
    const token = getToken(), run = this._uploadRun = (this._uploadRun || 0) + 1
    const current = () => !this._disposed && run === this._uploadRun && token === getToken()
    this.setData({ uploading:true });this.syncEditorState()
    try {
      const selected = await new Promise((resolve,reject) => wx.chooseMedia({ count:6-this.data.images.length,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:resolve,fail:reject }))
      for (const file of selected.tempFiles || []) {
        if (!current()) return
        const saved = await uploadMediaFile(BIZ_TYPE.ARTICLE_IMAGE,file.tempFilePath,{ maxBytes:MAX_IMAGE_BYTES,label:'文章图片' })
        if (!current()) return
        if (!this.data.images.some(image => image.mediaId === String(saved.id))) {this.setData({ images:[...this.data.images,{ mediaId:String(saved.id) }] });this.syncEditorState()}
      }
    } catch (error) { if (current() && !/cancel/i.test(error.errMsg || '')) wx.showToast({ title:error.message || '图片上传失败，请重试',icon:'none' }) }
    finally { if (current()) {this.setData({ uploading:false });this.syncEditorState()} }
  },
  async onAddVideo() {
    if(!social.active(this)||this.data.posting||this.data.uploading||this.data.loading||this.data.loadError||this.data.videos.length)return
    const token=getToken(),run=this._uploadRun=(this._uploadRun||0)+1
    const current=()=>!this._disposed&&run===this._uploadRun&&token===getToken()
    this.setData({uploading:true});this.syncEditorState()
    try {
      const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['video'],sourceType:['album','camera'],maxDuration:60,sizeType:['compressed'],success:resolve,fail:reject}))
      const file=(result.tempFiles||[])[0];if(!file||!current())return
      if(file.duration>60)throw new Error('请选择60秒以内的视频')
      if(file.size>20*1024*1024)throw new Error('视频不能超过20MB，请压缩后上传')
      const saved=await uploadMediaFile(BIZ_TYPE.ARTICLE_VIDEO,file.tempFilePath,{maxBytes:20*1024*1024,label:'视频'})
      if(current()){this.setData({videos:[{mediaId:String(saved.id)}]});this.syncEditorState()}
    }catch(error){if(current()&&!/cancel/i.test(error.errMsg||''))wx.showToast({title:error.message||'视频上传失败，请重试',icon:'none'})}
    finally{if(current()){this.setData({uploading:false});this.syncEditorState()}}
  },
  onRemoveVideo(){if(!this.data.posting&&!this.data.uploading){this.setData({videos:[]});this.syncEditorState()}},
  onRemoveImage(e) { if (!this.data.posting && !this.data.uploading) {this.setData({ images:this.data.images.filter(image => image.mediaId !== String(e.currentTarget.dataset.id)) });this.syncEditorState()} },
  setTags(codes) {
    const options=this._tagOptions||[],blocked=new Set((this._disabledTagNames||[]).map(n=>n.toLowerCase()))
    const valid=this._tagsReady?codes.filter(code=>options.some(t=>t.code===code)):codes
    const custom=this.data.customTags.filter(n=>!blocked.has(n.toLowerCase()))
    const removed=valid.length!==codes.length||custom.length!==this.data.customTags.length
    const selected=options.map(t=>({...t,selected:valid.includes(t.code)})),isUser=t=>t.type==='USER'||String(t.code).startsWith('custom_')
    this.setData({tagCodes:valid,customTags:custom,tags:selected.filter(t=>!isUser(t)),otherTags:selected.filter(isUser),selectedTags:selected.filter(t=>t.selected),tagCount:valid.length+custom.length,
      recentTags:tagHistory.list().filter(n=>!custom.includes(n)&&!options.some(t=>t.name===n)&&!blocked.has(n.toLowerCase())),...(removed?{tagNotice:'部分标签已删除，请重新选择'}:{})})
    this.syncEditorState()
  },
  onCustomTagInput(e) { this.setData({ customTagInput:e.detail.value });this.syncEditorState() },
  onAddCustomTag() {
    if (this.data.posting) return
    const name = publication.normalizeTag(this.data.customTagInput), issue = publication.tagIssue(name)
    if (issue) return wx.showToast({ title:issue, icon:'none' })
    if(!this._tagsReady)return wx.showToast({title:'请先加载标签后再选择',icon:'none'})
    if((this._disabledTagNames||[]).some(n=>n.toLowerCase()===name.toLowerCase()))return wx.showToast({title:'该标签已删除，请选择其他标签',icon:'none'})
    const key = name.toLowerCase(), builtin = (this._tagOptions||[]).find(tag => tag.name.toLowerCase() === key)
    if ((builtin && this.data.tagCodes.includes(builtin.code)) || this.data.customTags.some(tag => tag.toLowerCase() === key)) {
      this.setData({ customTagInput:'' });this.syncEditorState(); return wx.showToast({ title:'这个标签已经选过了', icon:'none' })
    }
    if (this.data.tagCount >= 3) return wx.showToast({ title:'最多选择3个标签', icon:'none' })
    if (builtin) this.setTags([...this.data.tagCodes,builtin.code])
    else { this.setData({ customTags:[...this.data.customTags,name] }); this.setTags(this.data.tagCodes) }
    tagHistory.remember([name]); this.setData({ customTagInput:'', recentTags:tagHistory.list().filter(n=>!this.data.customTags.includes(n) && !(this._tagOptions||[]).some(t=>t.name===n)) });this.syncEditorState()
  },
  onRemoveCustomTag(e) { if (this.data.posting) return; this.setData({ customTags:this.data.customTags.filter(tag => tag !== e.currentTarget.dataset.name) }); this.setTags(this.data.tagCodes) },
  onTag(e) {
    if (this.data.posting) return
    const code = e.currentTarget.dataset.code, codes = this.data.tagCodes
    if (!this._tagsReady || !(this._tagOptions||[]).some(tag => tag.code === code)) return
    if (codes.includes(code)) this.setTags(codes.filter(item => item !== code))
    else if (this.data.tagCount < 3) this.setTags([...codes,code])
    else wx.showToast({ title:'最多选择3个标签', icon:'none' })
  },
  async onSubmit() {
    if(this.data.tagsLoading||!this._tagsReady){wx.showToast({title:'请先加载标签后再选择',icon:'none'});return false}
    if (!social.active(this) || this.data.posting || this.data.uploading || this.data.loading || this.data.loadError || this.data.submitted) return
    if (this.data.customTagInput.trim()) { this.onAddCustomTag(); if (this.data.customTagInput.trim()) return }
    const issue = publication.validate(this.data.title,this.data.body,this.data.tagCodes,this.data.customTags,this.data.images.length+this.data.videos.length)
    if (issue) return wx.showToast({ title:issue, icon:'none' })
    const draft = { visibility:this.data.visibility,viewerIds:[...(this.data.viewerIds||[])].sort(),title:this.data.title.trim(), body:this.data.body.trim(), tagCodes:this.data.tagCodes, customTags:this.data.customTags, videoMediaIds:this.data.videos.map(video=>video.mediaId),imageMediaIds:this.data.images.map(image => image.mediaId), ...(this._id ? { revision:this.data.revision } : {}) }
    const fingerprint = JSON.stringify(draft)
    if (!this._attempt || this._attempt.fingerprint !== fingerprint) this._attempt = { fingerprint, payload:{ ...draft, clientRequestId:social.requestId() } }
    const version = this._communityVersion; this.setData({ posting:true });this.syncEditorState()
    try {
      let saved
      if(this._draftId) {
        const fingerprint=JSON.stringify(this.draftContent())
        if(!this._draftPublishAttempt || this._draftPublishAttempt.fingerprint!==fingerprint){const stored=await this.persistDraft(version);if(!stored)return;this._draftPublishAttempt={fingerprint,payload:{revision:stored.revision,clientRequestId:this._attempt.payload.clientRequestId}}}
        saved=await api.publishDraft(this._draftId,this._draftPublishAttempt.payload)
      } else saved = this._id ? await api.editCommunityArticle(this._id,this._attempt.payload) : await api.submitCommunityArticle(this._attempt.payload)
      if (!social.active(this,version)) return
      const publishedDraft=this._draftId;this._draftId='';this._draftRevision=null;this._draftPublishAttempt=null
      this._attempt = null; this.setData({ submitted:saved, statusInfo:publication.state(saved.state),draftSaved:false });this.syncEditorState();this.notifyDraftPublished(publishedDraft)
      wx.setNavigationBarTitle({ title:'投稿进度' })
    } catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) {this.setData({ posting:false });this.syncEditorState()} }
  },
  onMyArticles() { this.navigateWithoutGuard(()=>wx.redirectTo({url:'/pages/community-articles/community-articles',fail:()=>this.restoreAfterNavigationFailure()})) },
  onBackCommunity() { this.navigateWithoutGuard(()=>wx.switchTab({url:'/pages/index/index',fail:()=>this.restoreAfterNavigationFailure()})) }
})
