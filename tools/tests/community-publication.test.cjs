const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname,'../..')
const publication = require('../../utils/publication')
test('视频魔数仅接受MP4，拒绝图片、MOV和伪装后缀',()=>{
  const mod={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/media.js'),'utf8'),{module:mod,require:()=>({}),Uint8Array})
  const bytes=s=>Uint8Array.from([0,0,0,24,...Buffer.from(s)]).buffer
  assert.equal(mod.exports.sniffVideoMime(bytes('ftypisom0000mp42')),'video/mp4')
  assert.equal(mod.exports.sniffVideoMime(bytes('ftypqt  00000000')),'')
  assert.equal(mod.exports.sniffVideoMime(bytes('ftypavif00000000')),'')
  assert.equal(mod.exports.sniffVideoMime(bytes('not-a-mp4')),'')
})
test('回复请求使用目标路径，普通评论沿用原接口；用户内容和标签从对应接口读取',async()=>{
  const calls=[],mod={exports:{}},request={post:async(url,payload)=>{calls.push({url,payload})},get:async(url)=>{calls.push({url});return url.includes('/articles')?{records:[]}:[]}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'services/api.js'),'utf8'),{module:mod,require:key=>key==='../utils/request'?request:{}})
  await mod.exports.addNewsComment('20',{content:'回复',replyToCommentId:'7',clientRequestId:'wire-test-01'})
  await mod.exports.addNewsComment('20',{content:'普通评论',clientRequestId:'wire-test-02'})
  assert.equal(calls[0].url,'/news/20/comments/7/replies');assert.equal(calls[1].url,'/news/20/comments')
  await mod.exports.fetchProfileArticles('u2',{pageNum:1});await mod.exports.fetchMyCommunityTags()
  assert.equal(calls[2].url,'/community/profiles/u2/articles');assert.equal(calls[3].url,'/community/tags/mine')
})
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve() }
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a;reject=b });return {promise,resolve,reject} }

test('发文和存草稿保留所选可见范围，失败不丢失，回填后可以继续修改',async()=>{
  const {page:p,state}=page('community-compose');await flush()
  p.setData({title:'好友生活记录',body:'今天认真记录了早餐和运动情况，想和互相关注的好友一起交流。'});p.setTags(['daily'])
  p.onVisibilityConfirm({detail:{visibility:'FRIENDS',viewerIds:['3']}});await p.onSaveDraft()
  const draft=state.calls.find(row=>row.key==='createDraft').args[0];assert.equal(draft.visibility,'FRIENDS');assert.deepEqual(Array.from(draft.viewerIds),['3'])
  p.onVisibilityConfirm({detail:{visibility:'PRIVATE',viewerIds:[]}});assert.equal(p.hasUnsavedContent(),true)
  await p.onSubmit();const updated=state.calls.filter(row=>row.key==='updateDraft').at(-1).args[1];assert.equal(updated.visibility,'PRIVATE');assert.equal(updated.viewerIds.length,0);p.onUnload()
})

test('本人文章可见范围保存成功才回填，离页或换账号忽略迟到修改结果',async()=>{
  const late=deferred(),{page:p,state}=page('community-articles',{setArticleVisibility:()=>late.promise});await flush()
  p.setData({articles:[{id:'21',visibility:'PUBLIC',visibilityRevision:2,viewerIds:[]}]});p.onVisibility({currentTarget:{dataset:{id:'21'}}})
  const saving=p.onVisibilityConfirm({detail:{visibility:'PRIVATE',viewerIds:[]}});assert.equal(p.data.articles[0].visibility,'PUBLIC')
  late.resolve({visibility:'PRIVATE',revision:3,viewerIds:[]});await saving;assert.equal(p.data.articles[0].visibility,'PRIVATE');assert.equal(p.data.articles[0].visibilityRevision,3);assert.equal(state.calls.find(row=>row.key==='setArticleVisibility').args[1].revision,2)
  p.onUnload()
})

test('减少此类内容在保存后移除当前文章，失败保留，举报只打开表单',async()=>{
  const late=deferred(),{page:p,state,wx}=page('index',{hideCommunityArticle:()=>late.promise});await flush();const sheets=[];wx.showActionSheet=options=>sheets.push(options)
  p.setData({posts:[{id:'21',author:{isSelf:false}},{id:'22',author:{isSelf:false}}]});p.onReport({currentTarget:{dataset:{id:'21'}}})
  assert.deepEqual(Array.from(sheets[0].itemList),['举报','减少此类内容']);sheets[0].success({tapIndex:0});assert.match(state.navs.at(-1).url,/community-report/);assert.equal(state.calls.some(row=>row.key==='hideCommunityArticle'),false)
  const hiding=p.onHideArticle('21');assert.equal(p.data.posts.length,2);late.resolve({});await hiding;assert.deepEqual(Array.from(p.data.posts,row=>row.id),['22']);p.onUnload()
  const failed=page('index',{hideCommunityArticle:async()=>{throw Error('暂时不可用')}});await flush();failed.page.setData({posts:[{id:'21'}]});await failed.page.onHideArticle('21');assert.equal(failed.page.data.posts.length,1);failed.page.onUnload()
})

test('社区评论按钮带定位参数，正文入口保持原行为，非法文章ID不会导航',async()=>{
  const {page:p,state}=page('index');await flush()
  const event={currentTarget:{dataset:{id:'10'}}};p.onComments(event);p.onOpen(event)
  assert.equal(state.navs[0].url,'/pages/news-detail/news-detail?id=10&comments=1');assert.equal(state.navs[1].url,'/pages/news-detail/news-detail?id=10')
  p.onComments({currentTarget:{dataset:{id:'bad?id=2'}}});assert.equal(state.navs.length,2);p.onUnload()
})
test('社区卡片点赞收藏及关注显示服务器确认反馈，连点不重复，离页不回填',async()=>{
  const late=deferred();let first=true
  const {page:p,state}=page('index',{updateNewsAction:async(id,patch)=>{if(first){first=false;return late.promise}return{...patch}},setCommunityFollowing:async(key,followed)=>({key,followed})});await flush()
  p.setData({posts:[{id:'10',liked:false,collected:false,author:{key:'u2',followed:false}},{id:'11',author:{key:'u2',followed:false}}]})
  const tap=field=>({currentTarget:{dataset:{id:'10',field}}});const pending=p.onAction(tap('liked'));p.onAction(tap('liked'))
  assert.equal(state.calls.filter(c=>c.key==='updateNewsAction').length,1);assert.equal(state.feedback.length,0)
  late.resolve({liked:true,collected:false,likeCount:1,collectCount:0});await pending
  assert.equal(p.data.posts[0].likedPulse,1);assert.equal(p.data.posts[0].collectedPulse,undefined);assert.equal(p.data.posts[1].likedPulse,undefined)
  await p.onAction(tap('collected'));assert.equal(p.data.posts[0].likedPulse,1);assert.equal(p.data.posts[0].collectedPulse,1);assert.equal(p.data.posts[1].collectedPulse,undefined)
  const follow={currentTarget:{dataset:{key:'u2'}}};await p.onFollow(follow);assert.equal(p.data.posts.every(row=>row.author.followed),true);await p.onFollow(follow)
  assert.equal(state.feedback.join(','),'点赞成功,收藏成功,关注成功,取消关注成功')
  p.onUnload();p.onAction(tap('liked'));assert.equal(state.feedback.length,4)
})
function page(name, overrides={}, options={}) {
  const state={token:'one',calls:[],toasts:[],feedback:[],navs:[],modals:[],emitted:[],manualModals:false,storage:new Map()}
  const wx={getStorageSync:k=>state.storage.get(k),setStorageSync:(k,v)=>state.storage.set(k,v),showToast:v=>state.toasts.push(v), showModal:v=>{state.modals.push(v);if(!state.manualModals)v.success({confirm:true})}, navigateTo:v=>state.navs.push(v), redirectTo:v=>state.navs.push(v), switchTab:v=>state.navs.push(v), reLaunch:v=>state.navs.push(v), setNavigationBarTitle(){},stopPullDownRefresh(){},navigateBack:v=>state.navs.push({back:true,...v})}
  const request={getToken:()=>state.token}, socialModule={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'),{module:socialModule,wx,require:()=>request})
  const defaults={fetchMyCommunityTags:async()=>[],createDraft:async p=>({...p,id:'101',revision:1}),updateDraft:async(id,p)=>({...p,id,revision:p.revision+1}),fetchDrafts:async()=>({records:[],pages:0}),publishDraft:async()=>({id:'8',state:'AI_PENDING',title:'分享'}),fetchCommunityTags:async()=>publication.TAGS,fetchCommunityArticles:async()=>({records:[],pages:0}),fetchMyArticles:async()=>({records:[],pages:0}),submitCommunityArticle:async()=>({id:'8',state:'AI_PENDING',title:'分享'}),reportCommunityContent:async()=>({id:'9',state:'OPEN'}),...overrides}
  const api=new Proxy({}, {get:(_target,key)=>(...args)=>{state.calls.push({key,args});return defaults[key] ? defaults[key](...args) : Promise.resolve({})}})
  const media={ BIZ_TYPE:{ARTICLE_IMAGE:7,ARTICLE_VIDEO:8},MAX_IMAGE_BYTES:5*1024*1024,uploadMediaFile:async(...args)=>{state.calls.push({key:'uploadMediaFile',args});return overrides.uploadMediaFile?overrides.uploadMediaFile(...args):{id:'101'}} }
  const dependencies={'../../utils/media':media,'../../services/api':api,'../../utils/community':socialModule.exports,'../../utils/publication':publication,'../../utils/remote-image':{mapField:async rows=>rows,loadRemoteImage:async url=>url}, '../../utils/display':{applyDisplayToCurrentPage(){}},'../../utils/request':request}
  const history={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/article-tags.js'),'utf8'),{module:history,wx,require:key=>key==='./storage'?{getUserInfo:()=>({communityKey:state.token==='one'?'u1':'u2'})}:publication})
  dependencies['../../utils/article-tags']=history.exports
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root,`pages/${name}/${name}.js`),'utf8'),{Page:value=>{definition=value},wx,getApp:()=>({checkLogin:()=>!!state.token}),require:key=>{assert.ok(dependencies[key],key);return dependencies[key]}})
  const instance={...definition,data:JSON.parse(JSON.stringify(definition.data)),selectComponent:()=>({show:text=>state.feedback.push(text)}),setData(values){Object.assign(this.data,values)},getOpenerEventChannel:()=>({emit:(name,value)=>state.emitted.push({name,value})})}
  if(instance.onLoad) instance.onLoad(options)
  instance.onShow()
  return {page:instance,state,api,wx}
}

test('配图上传阻止提前提交，成功带媒体ID，失败保留已上传项且不会混入其他账号',async()=>{
  const pending=deferred(), {page:p,state,wx}=page('community-compose',{uploadMediaFile:()=>pending.promise})
  wx.chooseMedia=options=>options.success({tempFiles:[{tempFilePath:'one.jpg'}]})
  p.setData({title:'我的配图记录',body:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。'});p.setTags(['diet'])
  const uploading=p.onAddImage();await flush();assert.equal(p.data.uploading,true)
  await p.onSubmit();assert.equal(state.calls.filter(c=>c.key==='submitCommunityArticle').length,0)
  pending.resolve({id:'101'});await uploading;assert.equal(p.data.images[0].mediaId,'101')
  assert.equal(state.calls.find(c=>c.key==='uploadMediaFile').args[0],7)
  await p.onSubmit();assert.deepEqual(Array.from(state.calls.find(c=>c.key==='submitCommunityArticle').args[0].imageMediaIds),['101'])
  p.onUnload()
  const slow=deferred(), other=page('community-compose',{uploadMediaFile:()=>slow.promise})
  other.wx.chooseMedia=options=>options.success({tempFiles:[{tempFilePath:'old.jpg'}]})
  const task=other.page.onAddImage();await flush();other.page.onHide();other.state.token='two';other.page.onShow()
  slow.resolve({id:'102'});await task;assert.equal(other.page.data.images.length,0);other.page.onUnload()
})

test('短内容可存草稿，继续编辑保存版本后发布，发布重试不重复保存或创建文章',async()=>{
  let attempt=0
  const {page:p,state}=page('community-compose',{publishDraft:async()=>{if(!attempt++)throw new Error('网络超时');return{id:'8',state:'AI_PENDING'}}})
  p.setData({title:'草稿计划',body:'还没写完'});await p.onSaveDraft();assert.equal(p._draftId,'101');assert.equal(p._loaded,true)
  assert.equal(state.calls.filter(c=>c.key==='createDraft').length,1);assert.equal(state.calls.filter(c=>c.key==='submitCommunityArticle').length,0)
  p.onBody({detail:{value:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。'}});p.setTags(['diet']);await p.onSubmit();assert.equal(p.data.submitted,null)
  await p.onSubmit();assert.equal(p.data.submitted.state,'AI_PENDING')
  const calls=state.calls.filter(c=>c.key==='publishDraft');assert.equal(calls[0].args[1].clientRequestId,calls[1].args[1].clientRequestId)
  assert.equal(state.calls.filter(c=>c.key==='updateDraft').length,1);p.onUnload()
})

test('草稿箱读取本人保存数据，继续编辑使用草稿ID，删除成功后刷新列表',async()=>{
  let deleted=false
  const {page:p,state}=page('community-articles',{fetchDrafts:async()=>({records:deleted?[]:[{id:'81',title:'',body:'草稿正文',revision:3,images:[],tagCodes:[],customTags:[]}],total:deleted?0:1,pages:1}),deleteDraft:async()=>{deleted=true}},{mode:'drafts'})
  await flush();assert.equal(p.data.articles[0].title,'未命名草稿');assert.equal(p.data.totalCount,1);p.onArticleCard({currentTarget:{dataset:{id:'81'}}});assert.match(state.navs[0].url,/draft=81/)
  await p.onDeleteDraft({currentTarget:{dataset:{id:'81'}}});assert.equal(p.data.articles.length,0);assert.equal(p.data.totalCount,0);assert.equal(state.calls.find(c=>c.key==='deleteDraft').args[1],3);p.onUnload()
})

test('配图携带当前身份下载，换账号后迟到文件被清理，预览与离页不泄漏旧图',()=>{
  let definition,token='one';const downloads=[],removed=[],previews=[]
  const wx={downloadFile:options=>{downloads.push(options);return {abort(){}}},getFileSystemManager:()=>({unlink:value=>removed.push(value.filePath)}),previewImage:value=>previews.push(value)}
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/article-photo/article-photo.js'),'utf8'),{Component:value=>definition=value,wx,require:key=>key.endsWith('config')?{baseUrl:'https://example.test/api/v1'}:{getToken:()=>token}})
  const photo={...definition.methods,data:{source:'',error:false,mediaId:'101'},setData:value=>Object.assign(photo.data,value)}
  definition.lifetimes.attached.call(photo);assert.equal(downloads[0].header.Authorization,'Bearer one');assert.match(downloads[0].url,/article-images\/101$/)
  token='two';downloads[0].success({statusCode:200,tempFilePath:'old-photo.jpg'});assert.equal(photo.data.source,'');assert.ok(removed.includes('old-photo.jpg'))
  photo.load();downloads[1].success({statusCode:200,tempFilePath:'current-photo.jpg'});photo.preview();assert.equal(previews.length,1)
  definition.pageLifetimes.hide.call(photo);assert.equal(photo.data.source,'current-photo.jpg')
  definition.pageLifetimes.show.call(photo);assert.equal(downloads.length,2)
  definition.lifetimes.detached.call(photo);assert.ok(removed.includes('current-photo.jpg'));assert.equal(photo.data.source,'')
})

test('发文限制标签数量，校验通过后提交审核而不宣称公开发布',async()=>{
  const {page:p,state}=page('community-compose')
  await p.onSubmit();assert.equal(state.calls.filter(c=>c.key==='submitCommunityArticle').length,0)
  p.setData({title:'分享我的一餐',body:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。'})
  for(const code of ['diet','type1','daily','exercise']) p.onTag({currentTarget:{dataset:{code}}})
  assert.equal(p.data.tagCodes.length,3)
  await p.onSubmit();assert.equal(p.data.submitted.state,'AI_PENDING');assert.match(p.data.statusInfo.label,/等待/)
  assert.equal(state.calls.filter(c=>c.key==='submitCommunityArticle').length,1)
  p.onUnload()
})

test('投稿失败保留草稿和请求标识，重试不重复创建意图',async()=>{
  let attempt=0
  const {page:p,state}=page('community-compose',{submitCommunityArticle:async()=>{if(!attempt++)throw new Error('offline');return {id:'8',state:'PENDING_ADMIN'}}})
  p.setData({title:'我的记录经验',body:'今天坚持认真记录了一餐的搭配，也想听听大家日常记录的经验。'});p.setTags(['daily'])
  await p.onSubmit();assert.equal(p.data.submitted,null);assert.ok(p.data.body)
  await p.onSubmit();const calls=state.calls.filter(c=>c.key==='submitCommunityArticle')
  assert.equal(calls[0].args[0].clientRequestId,calls[1].args[0].clientRequestId)
  assert.match(p.data.statusInfo.label,/终审/);p.onUnload()
})

test('自定义标签可添加移除与预置去重，提交时带上文字并限制总数',async()=>{
  const {page:p,state}=page('community-compose')
  p.onCustomTagInput({detail:{value:' #我的早餐 '}});p.onAddCustomTag();assert.deepEqual(Array.from(p.data.customTags),['我的早餐'])
  p.onCustomTagInput({detail:{value:'我的早餐'}});p.onAddCustomTag();assert.equal(p.data.tagCount,1)
  p.onCustomTagInput({detail:{value:'饮食控糖'}});p.onAddCustomTag();assert.equal(p.data.tagCount,2);assert.equal(p.data.tagCodes[0],'diet')
  p.onCustomTagInput({detail:{value:'饭后散步'}});p.onAddCustomTag();p.onTag({currentTarget:{dataset:{code:'daily'}}});assert.equal(p.data.tagCount,3)
  p.onRemoveCustomTag({currentTarget:{dataset:{name:'饭后散步'}}});assert.equal(p.data.tagCount,2)
  p.setData({title:'记录我的早餐',body:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。',customTagInput:'周末记录'})
  await p.onSubmit();const payload=state.calls.find(c=>c.key==='submitCommunityArticle').args[0];assert.deepEqual(Array.from(payload.customTags),['我的早餐','周末记录']);assert.equal(payload.tagCodes[0],'diet');p.onUnload()
})

test('修改文章恢复自定义标签，换账号清除文字标签和输入草稿',async()=>{
  const {page:p,state}=page('community-compose',{fetchCommunityArticle:async()=>({mine:true,title:'旧标题',body:'旧正文',state:'AI_PENDING',revision:2,tags:[{code:'diet',name:'饮食控糖'},{code:'custom_one',name:'我的早餐'}]})},{id:'8'})
  await flush();assert.equal(p.data.tagCount,2);assert.equal(p.data.customTags[0],'我的早餐')
  p.onHide();state.token='two';p.onShow();assert.equal(p.data.customTags.length,0);assert.equal(p.data.customTagInput,'');p.onUnload()
})

test('举报只在接口成功后显示提交成功，失败重试复用请求标识',async()=>{
  let attempt=0
  const {page:p,state}=page('community-report',{reportCommunityContent:async()=>{if(!attempt++)throw new Error('offline');return {id:'9',state:'OPEN'}}},{type:'ARTICLE',id:'88'})
  await p.onSubmit();assert.equal(state.calls.filter(c=>c.key==='reportCommunityContent').length,0)
  p.onReason({currentTarget:{dataset:{code:'MISINFORMATION'}}})
  await p.onSubmit();assert.equal(p.data.success,false)
  await p.onSubmit();assert.equal(p.data.success,true)
  const calls=state.calls.filter(c=>c.key==='reportCommunityContent');assert.equal(calls[0].args[0].clientRequestId,calls[1].args[0].clientRequestId)
  assert.equal(calls[0].args[0].targetType,'ARTICLE');assert.equal(calls[0].args[0].targetId,'88');p.onUnload()
})

test('非法举报目标不发请求，其他原因必填说明，换账号清空私密草稿',async()=>{
  const invalid=page('community-report',{}, {type:'MESSAGE',id:'bad'});await invalid.page.onSubmit();assert.equal(invalid.state.calls.length,0);invalid.page.onUnload()
  const {page:p,state}=page('community-report',{}, {type:'MESSAGE',id:'88'})
  p.onReason({currentTarget:{dataset:{code:'OTHER'}}});await p.onSubmit();assert.equal(state.calls.length,0)
  p.setData({details:'属于上一个账号的描述'});p.onHide();state.token='two';p.onShow();assert.equal(p.data.details,'');assert.equal(p.data.reason,'');p.onUnload()
})

test('社区快速切换话题后，迟到的列表响应不会覆盖当前话题',async()=>{
  const old=deferred()
  const {page:p,state}=page('index',{fetchCommunityArticles:params=>params.tag==='diet'?Promise.resolve({records:[{id:'2',title:'当前话题'}],pages:1}):old.promise})
  p.onTag({currentTarget:{dataset:{code:'diet'}}});await flush()
  old.resolve({records:[{id:'1',title:'旧内容'}],pages:1});await flush()
  assert.equal(p.data.posts[0].id,'2');assert.equal(p.data.activeTag,'diet')
  const request=state.calls.filter(c=>c.key==='fetchCommunityArticles').at(-1);assert.equal(request.args[0].tag,'diet');p.onUnload()
})

test('我的文章切换账号时立即清除旧记录，审核状态文案不混淆通过与待审',async()=>{
  const {page:p,state}=page('community-articles',{fetchMyArticles:async()=>({records:[{id:'1',title:'旧账号文章',state:'PENDING_ADMIN',tags:[]},{id:'2',title:'已发布文章',state:'PUBLISHED',tags:[]}],total:2,pages:1})})
  await flush();assert.match(p.data.articles[0].statusInfo.label,/待管理员/);assert.equal(p.data.totalCount,2)
  p.onArticleCard({currentTarget:{dataset:{id:'1'}}});assert.match(state.navs[0].url,/community-compose.*id=1$/)
  p.onArticleCard({currentTarget:{dataset:{id:'2'}}});assert.match(state.navs[1].url,/news-detail.*id=2$/)
  p.setData({retrying:'1'});p.onArticleCard({currentTarget:{dataset:{id:'1'}}});assert.equal(state.navs.length,2)
  p.onHide();state.token='two';p.onShow();assert.equal(p.data.articles.length,0);assert.equal(p.data.totalCount,'');p.onUnload()
  assert.equal(publication.state('PUBLISHED').label,'已发布');assert.equal(publication.state('AI_ERROR').tone,'warning')
})

test('添加过的标签重新进入可点选，但不默认选中或串账号',async()=>{
 const {page:p,state}=page('community-compose');await flush();p.onCustomTagInput({detail:{value:'我的早餐'}});p.onAddCustomTag()
 p.onRemoveCustomTag({currentTarget:{dataset:{name:'我的早餐'}}});p.onHide();p.onShow();await flush()
 assert.ok(p.data.recentTags.includes('我的早餐'));assert.equal(p.data.customTags.length,0)
 p.onRecentTag({currentTarget:{dataset:{name:'我的早餐'}}});assert.equal(p.data.customTags[0],'我的早餐')
 p.onHide();state.token='two';p.onShow();await flush();assert.equal(p.data.recentTags.length,0);assert.equal(p.data.customTags.length,0);p.onUnload()
})
test('视频上传使用专用类型，只有媒体也能投稿并保存到草稿',async()=>{
 const {page:p,state,wx}=page('community-compose');await flush()
 wx.chooseMedia=o=>{assert.equal(o.mediaType[0],'video');o.success({tempFiles:[{tempFilePath:'clip.mp4',size:1024,duration:10}]})}
 await p.onAddVideo();assert.equal(state.calls.find(c=>c.key==='uploadMediaFile').args[0],8)
 p.setData({title:'我的控糖视频',body:''});p.setTags(['daily']);await p.onSaveDraft()
 assert.equal(state.calls.find(c=>c.key==='createDraft').args[0].videoMediaIds[0],'101')
 await p.onSubmit();assert.equal(p.data.submitted.state,'AI_PENDING');p.onUnload()
 assert.equal(publication.validate('图片分享','',['diet'],[],1),'')
 assert.match(publication.validate('文字分享','',['diet'],[],0),/至少20字/)
})
test('超长或过大视频在上传前拦截，失败不伪造附件',async()=>{
 const {page:p,state,wx}=page('community-compose');await flush()
 wx.chooseMedia=o=>o.success({tempFiles:[{tempFilePath:'clip.mp4',size:1024,duration:61}]});await p.onAddVideo()
 assert.equal(state.calls.filter(c=>c.key==='uploadMediaFile').length,0);assert.equal(p.data.videos.length,0);assert.equal(p.data.uploading,false);p.onUnload()
})

function backGesture(p){p.onGuardBeforeLeave();p.onGuardAfterLeave()}
test('未完成文章返回先询问，存草稿成功后才离开，原文完整入库',async()=>{
 const save=deferred(),{page:p,state}=page('community-compose',{createDraft:()=>save.promise});await flush();state.manualModals=true
 p.onTitle({detail:{value:'还没写完'}});p.onBody({detail:{value:'今天想分享的一点经历'}})
 assert.equal(p.data.leaveGuardActive,true);backGesture(p)
 const modal=state.modals[0];assert.equal(modal.cancelText,'确定返回');assert.equal(modal.confirmText,'存草稿');assert.match(modal.content,/尚未保存/)
 const done=modal.success({confirm:true});await flush();assert.equal(state.navs.length,0)
 const payload=state.calls.find(c=>c.key==='createDraft').args[0];assert.equal(payload.body,'今天想分享的一点经历')
 save.resolve({id:'101',revision:1});await done
 assert.equal(p.data.draftSaved,true);assert.equal(p.hasUnsavedContent(),false);assert.equal(state.navs[0].back,true);p.onUnload()
})
test('确定返回不自动保存或删除既有草稿，保存失败则保留编辑内容和返回保护',async()=>{
 const first=page('community-compose');await flush();first.state.manualModals=true;first.page.onBody({detail:{value:'不保存的文字'}});backGesture(first.page)
 await first.state.modals[0].success({cancel:true});assert.equal(first.state.navs[0].back,true);assert.equal(first.state.calls.filter(c=>c.key==='createDraft'||c.key==='deleteDraft').length,0);first.page.onUnload()
 const failed=page('community-compose',{createDraft:async()=>{throw Error('网络中断')}});await flush();failed.state.manualModals=true
 failed.page.onTitle({detail:{value:'不能丢失的草稿'}});backGesture(failed.page);await failed.state.modals[0].success({confirm:true})
 assert.equal(failed.state.navs.length,0);assert.equal(failed.page.data.title,'不能丢失的草稿');assert.equal(failed.page.data.leaveGuardActive,true)
 assert.equal(failed.page.data.draftSaved,false);failed.page.onUnload()
})
test('空白、未改的已保存内容和改回原样不提示，标签媒体改动或清空已存内容仍提示',async()=>{
 const {page:p,state}=page('community-compose');await flush();assert.equal(p.hasUnsavedContent(),false);assert.equal(p.data.leaveGuardActive,false)
 p.onBody({detail:{value:'写了一点'}});p.onBody({detail:{value:''}});assert.equal(p.hasUnsavedContent(),false)
 p.onTag({currentTarget:{dataset:{code:'diet'}}});assert.equal(p.hasUnsavedContent(),true);await p.onSaveDraft();assert.equal(p.hasUnsavedContent(),false)
 if(p._guardCloseMode==='sync')p.onGuardAfterLeave()
 p.onTag({currentTarget:{dataset:{code:'diet'}}});assert.equal(p.hasUnsavedContent(),true);assert.equal(p.hasEditorContent(),false)
 p.setData({images:[{mediaId:'101'}],videos:[{mediaId:'102'}]});p.captureSavedEditor();p.syncEditorState()
 p.onRemoveImage({currentTarget:{dataset:{id:'101'}}});assert.equal(p.hasUnsavedContent(),true)
 p.onRemoveVideo();assert.equal(p.hasUnsavedContent(),true);assert.equal(state.modals.length,0);p.onUnload()
})
test('加载已有草稿作为基线，重新进入仍保留未存修改，保存后返回不再提示',async()=>{
 const {page:p,state}=page('community-compose',{fetchDraft:async()=>({id:'81',title:'旧草稿',body:'未完成',revision:1,images:[],videos:[],tagCodes:[],customTags:[]})},{draft:'81'})
 await flush();assert.equal(p.hasUnsavedContent(),false);assert.equal(p.data.leaveGuardActive,false)
 p.onBody({detail:{value:'继续写了几句'}});p.onHide();p.onShow();await flush();assert.equal(p.data.body,'继续写了几句');assert.equal(p.hasUnsavedContent(),true)
 await p.onSaveDraft();if(p._guardCloseMode==='sync')p.onGuardAfterLeave();p.requestLeave();assert.equal(state.modals.length,0);assert.equal(state.navs.at(-1).back,true);p.onUnload()
})
test('发布成功立即清空编辑器草稿身份并通知草稿箱，不等待审核结果；失败不移除',async()=>{
 for(const status of ['AI_PENDING','PENDING_ADMIN','AI_REJECTED']){
  const {page:p,state}=page('community-compose',{publishDraft:async()=>({id:'8',state:status,title:'待审文章'})});await flush()
  p.onTitle({detail:{value:'我的分享'}});p.onBody({detail:{value:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。'}});p.setTags(['diet']);await p.onSaveDraft();await p.onSubmit()
  assert.equal(p._draftId,'');assert.equal(p.data.draftSaved,false);assert.equal(p.hasUnsavedContent(),false);assert.equal(p.data.leaveGuardActive,false)
  assert.equal(state.emitted[0].name,'draftPublished');assert.equal(state.emitted[0].value.id,'101');p.onUnload()
 }
 const failed=page('community-compose',{publishDraft:async()=>{throw Error('离线')}});await flush()
 failed.page.setData({title:'我的分享',body:'今天认真记录了一餐的搭配，也想听听大家日常记录的经验。'});failed.page.setTags(['daily']);await failed.page.onSaveDraft();await failed.page.onSubmit()
 assert.equal(failed.page._draftId,'101');assert.equal(failed.state.emitted.length,0);failed.page.onUnload()
})
test('收到同一账号的成功发布事件立即移除对应草稿，账号变化后忽略旧事件',async()=>{
 const {page:p,state}=page('community-articles',{fetchDrafts:async()=>({records:[{id:'81',title:'准备发布',body:'草稿',revision:1},{id:'82',title:'另一份',body:'草稿',revision:1}],pages:1})},{mode:'drafts'})
 await flush();p.onEdit({currentTarget:{dataset:{id:'81'}}});const event=state.navs[0].events.draftPublished;p.onHide();event({id:'81'})
 assert.equal(p.data.articles.map(a=>a.id).join(','),'82')
 p.onShow();await flush();p.onEdit({currentTarget:{dataset:{id:'81'}}});const old=state.navs[1].events.draftPublished;state.token='two';old({id:'81'});assert.equal(p.data.articles.length,2);p.onUnload()
})
test('保存离开途中换账号或退出页面不自动返回，也不写回旧草稿状态',async()=>{
 const slow=deferred(),{page:p,state}=page('community-compose',{createDraft:()=>slow.promise});await flush();state.manualModals=true
 p.onTitle({detail:{value:'旧账号文字'}});backGesture(p);const task=state.modals[0].success({confirm:true});await flush();p.onHide();state.token='two';p.onShow()
 slow.resolve({id:'101',revision:1});await task;assert.equal(state.navs.length,0);assert.equal(p.data.title,'');assert.equal(p.data.draftSaved,false);p.onUnload()
})

test('打开草稿箱先关闭返回保护，返回编辑器后仍保留未保存文字和提示',async()=>{
 const {page:p,state}=page('community-compose');await flush();p.onBody({detail:{value:'写了一半的内容'}})
 p.onDraftBox();assert.equal(state.navs.length,0);p.onGuardBeforeLeave();p.onGuardAfterLeave()
 assert.match(state.navs[0].url,/mode=drafts$/);assert.equal(state.modals.length,0)
 p.onHide();p.onShow();await flush();assert.equal(p.data.body,'写了一半的内容');assert.equal(p.hasUnsavedContent(),true);assert.equal(p.data.leaveGuardActive,true);p.onUnload()
})
