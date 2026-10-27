const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function runtime(){
  let app,definition,sequence=0
  const state={storage:new Map([['accessToken','old-account'],['isLoggedIn',true]]),calls:0,timers:new Map(),logs:[],queue:[],pages:[]}
  const request={getToken:()=>state.storage.get('accessToken')||'',setToken:token=>{if(token)state.storage.set('accessToken',token);else state.storage.delete('accessToken')}}
  const api={fetchInformationSummary(){state.calls++;return state.queue.shift()||Promise.resolve({total:0})}}
  const wx={setStorageSync:(k,v)=>state.storage.set(k,v),showToast(){}}
  const notifications={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/message-notifications.js'),'utf8'),{
    module:notifications,wx,getApp:()=>app,getCurrentPages:()=>state.pages,
    require:name=>name==='../services/api'?api:request,
    setInterval:fn=>{state.timers.set(++sequence,fn);return sequence},clearInterval:id=>state.timers.delete(id)
  })
  const deps={'./utils/i18n':{install(){}},'./utils/message-notifications':notifications.exports,
    './utils/display':{applyDisplayToCurrentPage(){},saveDisplaySettings(){}},'./utils/storage':{getUserInfo(){},saveUserInfo(){}},
    './utils/request':request,'./services/api':api,'./utils/mappers':{},
    './utils/config':{baseUrl:'https://example.test/api/v1',resolveBaseUrl:()=>({url:'https://example.test/api/v1',source:'test'}),envVersion:()=> 'develop',devicePlatform:()=> 'android'}}
  function launch(){vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),{
    // Reproduce WeChat registration: this exists in onLaunch but getApp() is still undefined.
    App:value=>{definition=value;value.globalData.unreadCount=9;value.globalData.informationCounts={messages:9,total:9};value.onLaunch();app=value},
    wx,getCurrentPages:()=>state.pages,require:name=>{assert.ok(deps[name],name);return deps[name]},
    console:{info:value=>state.logs.push(value),warn:value=>state.logs.push(value)}
  })}
  return{state,request,notifications:notifications.exports,launch,get definition(){return definition},register:value=>{app=value}}
}

test('注册中的onLaunch使用实际通知模块：getApp尚未就绪也能清理旧登录与全局角标',()=>{
  const flow=runtime();assert.doesNotThrow(()=>flow.launch());const {state,definition}=flow
  assert.equal(state.storage.has('accessToken'),false);assert.equal(state.storage.get('isLoggedIn'),false)
  assert.equal(definition.globalData.isLoggedIn,false);assert.equal(definition.globalData.unreadCount,0)
  assert.equal(definition.globalData.informationCounts.total,0);assert.equal(state.calls,0);assert.equal(state.timers.size,0)
  assert.ok(state.logs.some(line=>line.includes('[config] API')))
})

test('无App或globalData时重复重置及启动同步不抛错，App就绪后通知恢复且轮询不重复',async()=>{
  const flow=runtime(),n=flow.notifications
  assert.doesNotThrow(()=>n.reset());flow.register({});assert.doesNotThrow(()=>n.reset())
  flow.register(undefined);flow.request.setToken('new-account');assert.doesNotThrow(()=>{n.start();n.start()})
  await new Promise(r=>setImmediate(r));assert.equal(flow.state.timers.size,1)
  const app={globalData:{}},page={data:{},setData(value){Object.assign(this.data,value)}};flow.register(app);flow.state.pages=[page]
  flow.state.queue.push(Promise.resolve({messages:2,comments:1,total:3}));await n.refresh()
  assert.equal(app.globalData.unreadCount,3);assert.equal(page.data.informationCounts.total,3)
  n.start();assert.equal(flow.state.timers.size,1);assert.equal(page.data.unreadCount,3)
  n.reset(app);assert.equal(app.globalData.unreadCount,0);assert.equal(page.data.unreadLabel,'');assert.equal(flow.state.timers.size,0)
})
