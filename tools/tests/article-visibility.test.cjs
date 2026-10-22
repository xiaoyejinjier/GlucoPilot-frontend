const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function picker(fetch=async()=>({records:[],pages:0}),initial={}){
 const state={token:'one',calls:[],events:[],toasts:[]};let definition
 const api={fetchMutualFriends:args=>{state.calls.push(args);return fetch(args)}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/article-visibility/article-visibility.js'),'utf8'),{Component:v=>definition=v,require:name=>name.includes('services')?api:{getToken:()=>state.token},wx:{showToast:v=>state.toasts.push(v)}})
 const p={...definition.methods,data:{...JSON.parse(JSON.stringify(definition.data)),visible:true,value:'PUBLIC',viewerIds:[],busy:false,...initial},setData(data){Object.assign(this.data,data)},triggerEvent(name,detail){state.events.push({name,detail})}}
 definition.observers['visible,value,viewerIds'].call(p,true,p.data.value,p.data.viewerIds)
 return{p,state,definition}
}
test('可见范围选择器回填保存的私密和好友设置，公开模式不携带旧名单',async()=>{
 const {p,state}=picker(async()=>({records:[{userId:'3',nickname:'互关好友'}],pages:1}),{value:'FRIENDS',viewerIds:['3']});await flush()
 assert.equal(p.data.mode,'FRIENDS');assert.equal(p.data.friends[0].selected,true)
 p.confirm();assert.equal(state.events[0].detail.visibility,'FRIENDS');assert.deepEqual(Array.from(state.events[0].detail.viewerIds),['3'])
 p.onMode({currentTarget:{dataset:{value:'PUBLIC'}}});p.confirm();assert.deepEqual(Array.from(state.events[1].detail.viewerIds),[])
 const privatePicker=picker(undefined,{value:'PRIVATE'});assert.equal(privatePicker.p.data.mode,'PRIVATE');assert.equal(privatePicker.state.calls.length,0)
})
test('指定好友必须选择当前列表中的用户，分页选择保留，空名单不能确定',async()=>{
 const {p,state}=picker(async q=>({records:q.pageNum===1?[{userId:'3',nickname:'甲'}]:[{userId:'4',nickname:'乙'}],pages:2}),{value:'FRIENDS'});await flush()
 p.confirm();assert.equal(state.events.length,0);assert.match(state.toasts[0].title,/至少选择/)
 p.onFriend({currentTarget:{dataset:{id:'99'}}});assert.equal(p.data.selectedIds.length,0)
 p.onFriend({currentTarget:{dataset:{id:'3'}}});await p.loadFriends(false);p.onFriend({currentTarget:{dataset:{id:'4'}}});assert.deepEqual(Array.from(p.data.selectedIds),['3','4'])
 p.onClear();assert.equal(p.data.selectedIds.length,0);assert.equal(p.data.friends.some(row=>row.selected),false)
})
test('好友查询失败保留选择，切换账号或关闭后迟到结果不能回填或发送确认',async()=>{
 const late=pending(),{p,state,definition}=picker(()=>late.promise,{value:'FRIENDS',viewerIds:['3']});state.token='two';late.resolve({records:[{userId:'3',nickname:'旧账号好友'}],pages:1});await flush();assert.equal(p.data.friends.length,0);p.confirm();assert.equal(state.events.length,0)
 const closed=pending(),other=picker(()=>closed.promise,{value:'FRIENDS'});other.p.data.visible=false;other.definition.observers['visible,value,viewerIds'].call(other.p,false);closed.resolve({records:[{userId:'4'}],pages:1});await flush();assert.equal(other.p.data.friends.length,0)
 definition.lifetimes.detached.call(p)
})
test('权限、浏览、隐藏与互关列表均调用本人鉴权接口',async()=>{
 const calls=[],module={exports:{}},request={get:async(url,data,options)=>{calls.push({url,data,options});return{records:[]}},post:async(url,data,options)=>calls.push({url,data,options}),put:async(url,data,options)=>calls.push({url,data,options})}
 vm.runInNewContext(fs.readFileSync(path.join(root,'services/api.js'),'utf8'),{module,require:name=>name==='../utils/request'?request:{}})
 await module.exports.fetchMutualFriends({pageNum:1});await module.exports.setArticleVisibility('21',{visibility:'PRIVATE',viewerIds:[],revision:2});await module.exports.recordArticleView('21');await module.exports.hideCommunityArticle('21')
 assert.deepEqual(calls.map(c=>c.url),['/community/friends','/community/articles/21/visibility','/community/articles/21/views','/community/articles/21/hidden']);assert.ok(calls.every(c=>c.options.auth===true));assert.equal(calls[1].data.revision,2);assert.equal(calls[3].data.hidden,true)
})
