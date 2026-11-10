const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
const item={kind:'REPLY',id:'100',revision:'a'.repeat(64),recordDate:'2026-11-05',nodeCode:'before_breakfast',nodeName:'早餐前',glucoseValue:12.6,userReply:'公开回复',repliedAt:'2026-11-05T09:00:00',read:false}

function harness(overrides={}){
  let definition
  const state={token:'A',reads:[],navs:[]}
  const request={getToken:()=>state.token},wx={showToast(){},navigateTo:value=>state.navs.push(value),stopPullDownRefresh(){}}
  const shared={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'),{module:shared,require:()=>request,wx,getApp:()=>({})})
  const api={fetchUserReminder:async()=>({...item}),readUserReminder:async(...args)=>{state.reads.push(args)},...overrides}
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/glucose-reply/glucose-reply.js'),'utf8'),{
    Page:value=>{definition=value},wx,getApp:()=>({checkLogin:()=>!!state.token}),require:name=>name.endsWith('/api')?api:name.endsWith('/community')?shared.exports:name.endsWith('/request')?request:{applyDisplayToCurrentPage(){}}
  })
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(value,callback){Object.assign(this.data,value);if(callback)callback()}}
  page.onLoad({id:'100'});page.onShow()
  return{page,state}
}

test('回复详情内容加载成功后才标记当前版本，查看测量跳到对应日期和节点',async()=>{
  let resolve
  const {page,state}=harness({fetchUserReminder:()=>new Promise(done=>{resolve=done})})
  assert.equal(state.reads.length,0)
  resolve({...item});await flush()
  assert.deepEqual(state.reads,[['REPLY','100','a'.repeat(64)]])
  assert.equal(page.data.item.read,true)
  page.onRecord();assert.match(state.navs[0].url,/date=2026-11-05&nodeCode=before_breakfast/)
})

test('详情读取失败或加载中离开页面，不会标为已读',async()=>{
  const failed=harness({fetchUserReminder:async()=>{throw new Error('读取失败')}})
  await flush();assert.equal(failed.state.reads.length,0);assert.equal(failed.page.data.error,'读取失败')
  let resolve
  const left=harness({fetchUserReminder:()=>new Promise(done=>{resolve=done})})
  left.page.onHide();resolve({...item});await flush()
  assert.equal(left.state.reads.length,0);assert.equal(left.page.data.item,null)
})

test('已读失败保留完整回复并允许重试，旧账号回调不污染重新进入后的账号',async()=>{
  let fail=true
  const own=harness({readUserReminder:async()=>{if(fail)throw new Error('保存失败')}})
  await flush();assert.equal(own.page.data.item.userReply,'公开回复');assert.equal(own.page.data.readError,'保存失败')
  fail=false;await own.page.markRead();assert.equal(own.page.data.item.read,true)
  let resolve
  const switched=harness({fetchUserReminder:()=>new Promise(done=>{resolve=done})})
  switched.state.token='B';resolve({...item});await flush()
  assert.equal(switched.state.reads.length,0);assert.equal(switched.page.data.item,null)
})
