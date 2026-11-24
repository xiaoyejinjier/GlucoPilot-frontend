const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),catalog=require('../../utils/locales/en')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('分类入口的我的点赞和收藏继续收集文章英文标题，不翻译私信正文',()=>{
  const env=harness()
  const rows=env.content.collect({list:[{rowType:'ARTICLE',id:'10',title:'科学控糖'},{rowType:'MESSAGE',id:'11',title:'私信内容'}]},'pages/information/information')
  assert.equal(rows.size,1);assert.equal(rows.get('ARTICLE_PREVIEW:10').id,'10');assert.equal(rows.get('ARTICLE_PREVIEW:10').kind,'ARTICLE_PREVIEW')
})
function harness(response){
  const calls=[],timers=new Map();let timerId=0,token='account-a',titleUpdates=0
  const api={fetchEnglishLocalizations:async(items,retry)=>{calls.push({items:structuredClone(items),retry});return response?response(items,retry,calls.length):items.map(item=>({...item,status:'PENDING',source:{},translated:{}}))},mapNewsItem:({contentBody})=>({contentHtml:contentBody.includes('<p>')?contentBody.replace('/api/v1/cms/images/','https://api.example/api/v1/cms/images/'):''})}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/content-localization.js'),'utf8'),{module,require:name=>name.includes('services/api')?api:{getToken:()=>token},
    setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId},clearTimeout:id=>timers.delete(id)})
  const content=module.exports
  function page(data={},route='pages/index/index'){
    const value={route,data:{locale:'en',posts:[{id:'10',title:'中文标题',summary:'中文摘要',author:{key:'u1',nickname:'小林'}}],...data},updates:[],setData(patch,callback){this.updates.push(structuredClone(patch));Object.assign(this.data,patch);if(callback)callback()}}
    content.attach(value,()=>titleUpdates++);content.start(value);return value
  }
  async function tick(){const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1].callback();await flush();await flush()}}
  return {content,page,calls,timers,tick,setToken:next=>{token=next},titleUpdates:()=>titleUpdates}
}
function ready(items){return items.map(item=>({...item,status:'READY',source:item.kind==='PROFILE_NAME'?{nickname:'小林'}:{title:'中文标题',summary:'中文摘要'},translated:item.kind==='PROFILE_NAME'?{nickname:'Lin'}:{title:'English title',summary:'English summary'}}))}
test('一批读取文章标题摘要和英文名，只写独立显示表，不覆盖原稿昵称与表单',async()=>{
  const env=harness(ready),page=env.page({form:{nickname:'自己编辑的原名',body:'未保存的中文'}})
  await env.tick();assert.equal(env.calls.length,1)
  assert.deepEqual(Array.from(env.calls[0].items,item=>item.kind).sort(),['ARTICLE_PREVIEW','PROFILE_NAME'])
  assert.equal(page.data.posts[0].title,'中文标题');assert.equal(page.data.posts[0].author.nickname,'小林');assert.equal(page.data.form.body,'未保存的中文')
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','10','title','中文标题','en'),'English title')
  assert.equal(catalog.name(page.data.contentTranslations,page.data.posts[0].author,'en'),'Lin')
  assert.equal(catalog.name(page.data.contentTranslations,page.data.posts[0].author,'zh-CN'),'小林')
  assert.equal(page.data.contentTranslationLoading,false);assert.equal(env.timers.size,0)
  env.content.stop(page)
})
test('PENDING显示准备状态并定时复查，READY后停止，普通交互不重复请求',async()=>{
  const env=harness((items,_retry,n)=>n===1?items.map(item=>({...item,status:'PENDING'})):ready(items)),page=env.page()
  await env.tick();assert.equal(page.data.contentTranslationLoading,true);assert.equal([...env.timers.values()][0].delay,2000)
  await env.tick();assert.equal(page.data.contentTranslationLoading,false);assert.equal(env.calls.length,2)
  page.setData({counter:1});await env.tick();assert.equal(env.calls.length,2);env.content.stop(page)
})
test('正文优先于大量昵称排队，详情每800毫秒读取结果且就绪后停止',async()=>{
  const names=Array.from({length:25},(_,i)=>({key:'u'+(i+20),nickname:'小林'}))
  const env=harness((items,_retry,n)=>items.map(item=>n===1?{...item,status:'PENDING'}:item.kind==='ARTICLE_BODY'
    ?{...item,status:'READY',source:{body:'中文正文'},translated:{body:'Article body'}}:ready([item])[0]))
  const page=env.page({posts:[],news:{id:'10',title:'中文标题',summary:'中文摘要',contentBody:'中文正文'},names},'pages/news-detail/news-detail')
  await env.tick()
  assert.equal(env.calls[0].items[0].kind,'ARTICLE_BODY')
  assert.equal(env.calls[0].items[1].kind,'ARTICLE_PREVIEW')
  // 先提交剩余未请求项，再进入详情页的更快状态轮询。
  await env.tick()
  assert.equal(page.data.contentTranslationLoading,true)
  assert.equal([...env.timers.values()][0].delay,800)
  await env.tick()
  assert.equal(page.data.contentTranslations['ARTICLE_BODY:10'].translated.body,'Article body')
  assert.equal(page.data.contentTranslationLoading,false)
  assert.equal(env.timers.size,0)
  env.content.stop(page)
})
test('切回中文或换账号后，迟到译文不能覆盖当前页面',async()=>{
  let resolve;const env=harness(()=>new Promise(done=>resolve=done)),page=env.page()
  await env.tick();page.setData({locale:'zh-CN'});resolve(ready(env.calls[0].items));await flush()
  assert.equal(Object.keys(page.data.contentTranslations).length,0);assert.equal(env.timers.size,0);assert.equal(page.data.posts[0].title,'中文标题')
  page.setData({locale:'en'});await env.tick();env.setToken('account-b');page.setData({input:'新账号的输入'});resolve(ready(env.calls[1].items));await flush()
  assert.equal(Object.keys(page.data.contentTranslations).length,0);assert.equal(page.data.input,'新账号的输入');env.content.stop(page)
})
test('退出页面取消轮询，重新进入重新授权缓存，旧回调不回填',async()=>{
  let resolve;const env=harness(()=>new Promise(done=>resolve=done)),page=env.page()
  await env.tick();env.content.stop(page);resolve(ready(env.calls[0].items));await flush()
  assert.equal(Object.keys(page.data.contentTranslations).length,0);assert.equal(env.timers.size,0)
  env.content.start(page);await env.tick();assert.equal(env.calls.length,2);resolve(ready(env.calls[1].items));await flush();env.content.stop(page)
})
test('原文或ID不符的译文不能显示，更新原文自动重新读取',async()=>{
  const env=harness(items=>ready(items).map(item=>item.kind==='ARTICLE_PREVIEW'?{...item,source:{title:'旧标题',summary:'旧摘要'}}:item)),page=env.page()
  await env.tick();assert.equal(page.data.contentTranslationError,true)
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','10','title','中文标题','en'),'中文标题')
  page.setData({posts:[{id:'10',title:'新标题',summary:'新摘要'}]});await env.tick();assert.equal(env.calls.length,2)
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','99','title','中文标题','en'),'中文标题');env.content.stop(page)
})
test('失败只显示原文和重试提示，显式点击才携带retry重试',async()=>{
  const env=harness((items,_retry,n)=>n===1?items.map(item=>({...item,status:'FAILED'})):ready(items)),page=env.page()
  await env.tick();assert.equal(page.data.contentTranslationError,true);assert.equal(page.data.contentTranslationLoading,false);assert.equal(env.timers.size,0)
  env.content.retry(page);await env.tick();assert.equal(env.calls[1].retry,true);assert.equal(page.data.contentTranslationError,false);env.content.stop(page)
})
test('不可用译文保留原文并提示，显式重试后仍以服务端权限和结果为准',async()=>{
  const unavailable=items=>items.map(item=>({...item,status:'UNAVAILABLE',source:{},translated:{}}))
  const env=harness((items,_retry,n)=>n<3?unavailable(items):ready(items)),page=env.page()
  await env.tick()
  assert.equal(page.data.contentTranslationError,true);assert.equal(page.data.contentTranslationLoading,false);assert.equal(env.timers.size,0)
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','10','title','中文标题','en'),'中文标题')
  assert.equal(Object.keys(page.data.contentTranslations['ARTICLE_PREVIEW:10'].source).length,0)
  env.content.retry(page);await env.tick()
  assert.equal(env.calls[1].retry,true);assert.equal(page.data.contentTranslationError,true);assert.equal(env.timers.size,0)
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','10','title','中文标题','en'),'中文标题')
  env.content.retry(page);await env.tick()
  assert.equal(page.data.contentTranslationError,false)
  assert.equal(catalog.content(page.data.contentTranslations,'ARTICLE_PREVIEW','10','title','中文标题','en'),'English title')
  assert.equal(page.data.posts[0].title,'中文标题');env.content.stop(page)
})
test('HTML正文使用独立译文并解析原媒体地址，纯文本不升级为rich-text',async()=>{
  const html='<p>中文正文</p><img src="/api/v1/cms/images/42">'
  const env=harness(items=>items.map(item=>item.kind==='ARTICLE_BODY'?{...item,status:'READY',source:{body:html},translated:{body:'<p>English body</p><img src="/api/v1/cms/images/42">'}}:{...item,status:'READY',source:{title:'中文标题',summary:'中文摘要'},translated:{title:'English title',summary:'English summary'}}))
  const page=env.page({posts:[],news:{id:'10',title:'中文标题',summary:'中文摘要',contentBody:html,contentHtml:html}},'pages/news-detail/news-detail')
  await env.tick();assert.ok(page.data.contentTranslations['ARTICLE_BODY:10'].translated.body.includes('https://api.example/api/v1/cms/images/42'))
  assert.equal(page.data.news.contentBody,html);assert.ok(env.titleUpdates()>0)
  assert.equal(env.content.title(page,'中文标题','en'),'English title');assert.equal(env.content.title(page,'中文标题','zh-CN'),'中文标题')
  const template=fs.readFileSync(path.join(root,'pages/news-detail/news-detail.wxml'),'utf8')
  assert.ok(template.includes('wx:if="{{news.contentHtml}}"'));assert.ok(template.includes('wx:elif="{{news.contentBody}}"'));env.content.stop(page)
})
test('我的点赞列表沿用英文文章翻译',()=>{
  const env=harness(ready)
  const items=env.content.collect({mode:'likes',list:[{id:'10',title:'科学控糖',summary:'健康生活'}]},'pages/community/community')
  assert.equal(items.get('ARTICLE_PREVIEW:10').source.title,'科学控糖')
})
test('问诊列表、医生工作台和会话入口按问诊ID翻译标题，订单服务名使用静态翻译',()=>{
  const env=harness()
  for(const name of ['consultation','consultation-doctor','consultation-conversations','consultation-records']){
    const found=env.content.collect({records:[{id:'21',title:'求助标题'}]},`pages/${name}/${name}`)
    assert.equal(found.get('CONSULTATION_PREVIEW:21').source.title,'求助标题')
  }
  const conversations=env.content.collect({records:[{consultationId:'21',title:'求助标题'}]},'pages/consultation-conversations/consultation-conversations')
  assert.equal(conversations.get('CONSULTATION_PREVIEW:21').id,'21')
  const orders=env.content.collect({tab:'orders',records:[{id:'CO_ORDER',consultationId:'21',title:'问诊单查看服务'}]},'pages/consultation-records/consultation-records')
  assert.equal(orders.size,0)
})
test('问诊未解锁或非参与者只请求标题，预览和医生未保存的表单不翻译',()=>{
  const env=harness(),route='pages/consultation-detail/consultation-detail'
  const item={id:'21',title:'求助标题',symptoms:'症状描述',glucoseNote:'血糖 5.2 mmol/L',medicationNote:'用药情况'}
  const report={access:'LOCKED',assessment:'不能读的内容',medicationAdvice:'不能读的建议'}
  let found=env.content.collect({item,report,form:{assessment:'未保存的医生输入'}},route)
  assert.deepEqual([...found.keys()],['CONSULTATION_PREVIEW:21'])
  found=env.content.collect({item:{...item,detailsVisible:true},report},route)
  assert.equal(found.has('CONSULTATION_DETAIL:21'),true);assert.equal(found.has('CONSULTATION_REPORT:21'),false)
  assert.equal(env.content.collect({item,report,previewMode:true},route).size,0)
  assert.equal(env.content.collect({form:item},'pages/consultation-compose/consultation-compose').size,0)
  const chat=env.content.collect({item,messages:[{id:'99',content:'聊天原文'}],input:'尚未发送'},'pages/consultation-chat/consultation-chat')
  assert.deepEqual([...chat.keys()],['CONSULTATION_PREVIEW:21'])
})
test('已解锁问诊单和健康描述使用独立英文显示表，不覆盖医生表单或原稿',async()=>{
  const item={id:'21',title:'求助标题',detailsVisible:true,symptoms:'症状描述',glucoseNote:'血糖 5.2 mmol/L',medicationNote:'用药 10 mg'}
  const report={access:'UNLOCKED',assessment:'医生评估',medicationAdvice:'用药建议',followUpAdvice:'复查建议'}
  const sources={CONSULTATION_PREVIEW:{title:item.title},CONSULTATION_DETAIL:{symptoms:item.symptoms,glucoseNote:item.glucoseNote,medicationNote:item.medicationNote},
    CONSULTATION_REPORT:{assessment:report.assessment,medicationAdvice:report.medicationAdvice,followUpAdvice:report.followUpAdvice}}
  const env=harness(items=>items.map(value=>({...value,status:'READY',source:sources[value.kind],translated:Object.fromEntries(Object.keys(sources[value.kind]).map(key=>[key,'English '+key]))})))
  const page=env.page({posts:[],item,report,form:{assessment:'医生正在输入'}},'pages/consultation-detail/consultation-detail')
  await env.tick()
  assert.equal(env.calls[0].items[0].kind,'CONSULTATION_DETAIL')
  assert.equal(page.data.item.symptoms,'症状描述');assert.equal(page.data.report.assessment,'医生评估');assert.equal(page.data.form.assessment,'医生正在输入')
  assert.equal(catalog.content(page.data.contentTranslations,'CONSULTATION_REPORT','21','assessment',report.assessment,'en'),'English assessment')
  assert.equal(catalog.content(page.data.contentTranslations,'CONSULTATION_REPORT','21','assessment',report.assessment,'zh-CN'),'医生评估')
  assert.equal(page.data.contentTranslationLoading,false)
  page.setData({report:{access:'LOCKED'}});await env.tick()
  assert.equal(page.data.contentTranslations['CONSULTATION_REPORT:21'],undefined)
  env.content.stop(page)
})

test('中文模式不请求翻译，草稿编辑和非发布文章也不提交翻译',async()=>{
  const env=harness(ready),page=env.page({locale:'zh-CN'});await env.tick();assert.equal(env.calls.length,0)
  assert.equal(env.content.collect({mode:'drafts',articles:[{id:'10',title:'草稿',body:'正文'}],form:{nickname:'小林',key:'u1'}},'pages/community-articles/community-articles').size,0)
  assert.equal(env.content.collect({articles:[{id:'10',state:'PENDING_ADMIN',title:'待审文章'}]},'pages/community-articles/community-articles').size,0);env.content.stop(page)
})
test('英文原名仅作用于展示，私信、评论、未保存输入与头像初始字不被改动',()=>{
  const raw={locale:'en',peer:{key:'u1',nickname:'小林'},messages:[{id:'99',content:'请不要翻译我发出的原话'}],input:'当前输入',avatarText:'林'}
  const env=harness();const requests=env.content.collect(raw,'pages/messages/messages')
  assert.equal(requests.size,1);assert.equal([...requests.values()][0].kind,'PROFILE_NAME');assert.equal(raw.messages[0].content,'请不要翻译我发出的原话');assert.equal(raw.avatarText,'林')
})
