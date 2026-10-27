const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),catalog=require('../../utils/locales/en')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
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
