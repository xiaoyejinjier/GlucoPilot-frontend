// Display-only translations. Canonical page data and form values never change.
const api=require('../services/api')
const {getToken}=require('./request')
const HAN=/[一-龥]/
const PROFILE=/^[ub][1-9]\d{0,18}$/
const ARTICLE=/^[1-9]\d{0,18}$/
function keyOf(kind,id){return kind+':'+id}
function profileKey(value){return value&&(value.key||value.communityKey||(value.userId?'u'+value.userId:''))||''}
function collect(data,route){
  const found=new Map()
  const add=(kind,id,source)=>{
    id=String(id||'')
    if(!(kind==='PROFILE_NAME'?PROFILE:ARTICLE).test(id)||!Object.values(source).some(value=>HAN.test(value)))return
    found.set(keyOf(kind,id),{kind,id,source,signature:JSON.stringify(source)})
  }
  function article(value,body=false){
    if(!value||value.state&&value.state!=='PUBLISHED')return
    add('ARTICLE_PREVIEW',value.id,{title:value.title||'',summary:value.summary||''})
    if(body&&value.contentBody)add('ARTICLE_BODY',value.id,{body:value.contentBody})
  }
  article(data.news,true)
  for(const value of data.posts||[])article(value)
  if(data.mode!=='drafts')for(const value of data.articles||[])article(value)
  if(route==='pages/community/community'&&(data.mode==='collections'||data.mode==='likes'))for(const value of data.list||[])article(value)
  const seen=new Set()
  function names(value,depth){
    if(!value||typeof value!=='object'||depth>8||seen.has(value))return
    seen.add(value)
    if(typeof value.nickname==='string')add('PROFILE_NAME',profileKey(value),{nickname:value.nickname})
    if(value.newsId&&value.newsTitle)add('ARTICLE_PREVIEW',value.newsId,{title:value.newsTitle})
    for(const [name,child]of Object.entries(value))if(!['contentTranslations','form','body','contentBody','contentHtml','content','input','inputValue','source','translated'].includes(name)){
      if(Array.isArray(child))child.slice(0,150).forEach(item=>names(item,depth+1));else names(child,depth+1)
    }
  }
  names(data,0)
  return found
}
function current(page,state,version){return state.active&&page.data.locale==='en'&&state.version===version&&state.token===getToken()}
function patch(page,state,data){state.applying=true;try{state.original.call(page,data)}finally{state.applying=false}}
function attach(page,onReady){
  if(page._contentLocalization)return
  const state={original:page.setData,active:false,version:0,token:'',results:new Map(),busy:false,applying:false,onReady}
  page._contentLocalization=state
  page.setData=function(data,callback){
    const result=state.original.call(this,data,callback)
    if(!state.applying)schedule(this)
    return result
  }
}
function start(page){
  const state=page._contentLocalization;if(!state)return
  stop(page);state.active=true;state.token=getToken();state.results.clear();state.started=Date.now()
  state.wasEnglish=false
  state.retryKeys=new Set()
  patch(page,state,{contentTranslations:{},contentTranslationLoading:false,contentTranslationError:false})
  schedule(page)
}
function stop(page){
  const state=page._contentLocalization;if(!state)return
  state.active=false;state.version++;state.busy=false
  clearTimeout(state.timer);state.timer=null
}
function schedule(page){
  const state=page._contentLocalization
  if(!state||!state.active)return
  if(state.token!==getToken()){
    stop(page);state.results.clear();patch(page,state,{contentTranslations:{},contentTranslationLoading:false,contentTranslationError:false});return
  }
  if(page.data.locale!=='en'){
    state.wasEnglish=false
    if(state.busy||state.timer||state.results.size){state.version++;state.busy=false;state.results.clear();clearTimeout(state.timer);state.timer=null;patch(page,state,{contentTranslations:{},contentTranslationLoading:false,contentTranslationError:false})}
    return
  }
  if(!state.wasEnglish){state.wasEnglish=true;state.started=Date.now()}
  if(!state.token||state.busy||state.timer)return
  state.timer=setTimeout(()=>{state.timer=null;run(page)},100)
}
function matches(entry,source){return entry&&entry.status==='READY'&&Object.entries(source).every(([field,value])=>entry.source&&entry.source[field]===value&&typeof entry.translated[field]==='string')}
function display(page,state,wanted){
  const table={};let pending=false,error=false
  for(const [key,item]of wanted){
    const record=state.results.get(key)
    if(!record||record.signature!==item.signature){pending=true;continue}
    table[key]=record.entry
    if(record.entry.status==='PENDING')pending=true
    if(['FAILED','OUTDATED','UNAVAILABLE'].includes(record.entry.status))error=true
  }
  patch(page,state,{contentTranslations:table,contentTranslationLoading:pending,contentTranslationError:error})
  if(state.onReady&&['pages/news-detail/news-detail','pages/messages/messages'].includes(page.route))state.onReady(page)
}
async function run(page){
  const state=page._contentLocalization;if(!state||state.busy||!current(page,state,state.version))return
  const version=state.version,wanted=collect(page.data,page.route||'')
  const jobs=[...wanted].filter(([key,item])=>{const known=state.results.get(key);return!known||known.signature!==item.signature||known.entry.status==='PENDING'})
    .sort(([a],[b])=>Number(state.results.has(a))-Number(state.results.has(b))).slice(0,20)
  if(!jobs.length){display(page,state,wanted);return}
  state.busy=true;display(page,state,wanted)
  const retry=jobs.some(([key])=>state.retryKeys&&state.retryKeys.has(key))
  try{
    const response=await api.fetchEnglishLocalizations(jobs.map(([,item])=>({kind:item.kind,id:item.id})),retry)
    if(!current(page,state,version))return
    const records=new Map((Array.isArray(response)?response:[]).map(entry=>[keyOf(entry.kind,entry.id),entry]))
    for(const [key,item]of jobs){
      let entry=records.get(key)||{kind:item.kind,id:item.id,status:'FAILED',source:{},translated:{}}
      entry={...entry,source:entry.source||{},translated:{...(entry.translated||{})}}
      if(!['READY','PENDING','FAILED','UNAVAILABLE'].includes(entry.status))entry.status='FAILED'
      if(entry.status==='READY'&&!matches(entry,item.source))entry={...entry,status:'OUTDATED'}
      if(entry.status==='READY'&&item.kind==='ARTICLE_BODY'&&entry.translated.body&&api.mapNewsItem){
        const html=api.mapNewsItem({contentBody:entry.translated.body}).contentHtml
        if(html)entry.translated.body=html
      }
      // Do not keep polling indefinitely; the cached server job may finish for a later visit.
      if(entry.status==='PENDING'&&Date.now()-state.started>180000)entry={...entry,status:'FAILED'}
      state.results.set(key,{signature:item.signature,entry})
      if(state.retryKeys)state.retryKeys.delete(key)
    }
  }catch(error){
    if(!current(page,state,version))return
    for(const [key,item]of jobs)state.results.set(key,{signature:item.signature,entry:{kind:item.kind,id:item.id,status:'FAILED',source:{},translated:{}}})
  }finally{
    if(current(page,state,version)){
      state.busy=false
      const latest=collect(page.data,page.route||'');display(page,state,latest)
      const hasUnrequested=[...latest].some(([key,item])=>!state.results.has(key)||state.results.get(key).signature!==item.signature)
      const pending=[...latest].some(([key])=>state.results.get(key)?.entry.status==='PENDING')
      if(hasUnrequested||pending)state.timer=setTimeout(()=>{state.timer=null;run(page)},hasUnrequested?100:2000)
    }
  }
}
function retry(page){
  const state=page._contentLocalization;if(!state||state.busy||!state.active)return
  for(const [key,value]of state.results)if(value.entry.status!=='READY'){state.retryKeys.add(key);state.results.delete(key)}
  clearTimeout(state.timer);state.timer=null;state.started=Date.now();schedule(page)
}
function title(page,raw,locale){
  if(locale!=='en')return raw
  let kind,id,field
  if(page.route==='pages/news-detail/news-detail'&&page.data.news){kind='ARTICLE_PREVIEW';id=page.data.news.id;field='title'}
  if(page.route==='pages/messages/messages'&&page.data.peer){kind='PROFILE_NAME';id=profileKey(page.data.peer);field='nickname'}
  const entry=page.data.contentTranslations&&page.data.contentTranslations[keyOf(kind,id)]
  return entry&&entry.status==='READY'&&entry.source[field]===raw?entry.translated[field]||raw:raw
}
module.exports={attach,start,stop,retry,title,collect,profileKey}
