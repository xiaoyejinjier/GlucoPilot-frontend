const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function harness(options={}){
 const state={token:'first',cache:{nickname:'旧缓存'},saves:[],calls:[],modals:[],navs:[],loading:0,reset:0,cleared:0}
 const app={globalData:{isLoggedIn:true,userInfo:state.cache,unreadCount:3},checkLogin:()=>!!state.token,resetLoginState(){state.reset++;state.token='';this.globalData.isLoggedIn=false;this.globalData.userInfo=null;this.globalData.unreadCount=0}}
 const impl={fetchMe:async()=>({nickname:'当前糖友',communityKey:'u1'}),fetchGlucoseSummary:async()=>({todayCount:2,totalNodes:9,todayAvg:5.5,streakDays:3}),logoutRemote:async()=>{},...options}
 const api=Object.fromEntries(Object.entries(impl).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
 const wx={showModal:o=>state.modals.push(o),showLoading:()=>state.loading++,hideLoading:()=>state.loading--,reLaunch:o=>state.navs.push(o),showToast(){},navigateTo(){}}
 const deps={'../../services/api':api,'../../utils/storage':{getUserInfo:()=>state.cache,saveUserInfo:v=>{state.cache=v;state.saves.push(v)},logout:()=>{state.cleared++;state.cache=null}},'../../utils/request':{getToken:()=>state.token},'../../utils/display':{applyDisplayToCurrentPage(){}}}
 let def;vm.runInNewContext(fs.readFileSync(path.join(root,'pages/mine/mine.js'),'utf8'),{Page:x=>def=x,getApp:()=>app,wx,require:k=>{assert.ok(deps[k],k);return deps[k]}})
 const p={...def,data:JSON.parse(JSON.stringify(def.data)),setData:v=>Object.assign(p.data,v)};p.onShow();return{p,state,app}
}
test('我的页面直接退出登录，确认后撤销会话并清空本地状态，连点不重复',async()=>{
 const {p,state,app}=harness();await flush();p.onLogout();p.onLogout();assert.equal(state.modals.length,1)
 state.modals[0].success({confirm:true});p.onLogout();await flush()
 assert.equal(state.calls.filter(c=>c.key==='logoutRemote').length,1);assert.equal(state.reset,1);assert.equal(state.cleared,1)
 assert.equal(state.cache,null);assert.equal(app.globalData.unreadCount,0);assert.equal(p.data.unreadCount,0);assert.equal(state.loading,0);assert.match(state.navs[0].url,/pages\/login\/login/)
})
test('取消退出不改登录或发送请求，网络失败仍完成本机退出',async()=>{
 const {p,state}=harness({logoutRemote:async()=>{throw Error('网络故障')}});await flush()
 p.onLogout();state.modals[0].success({confirm:false});await flush();assert.equal(state.token,'first');assert.equal(state.calls.filter(c=>c.key==='logoutRemote').length,0)
 p.onLogout();state.modals[1].success({confirm:true});await flush();assert.equal(state.token,'');assert.equal(state.navs.length,1)
})
test('退出时未完成的资料与统计请求不会恢复缓存或填回旧用户',async()=>{
 const me=deferred(),summary=deferred(),{p,state}=harness({fetchMe:()=>me.promise,fetchGlucoseSummary:()=>summary.promise})
 p.onLogout();state.modals[0].success({confirm:true});await flush()
 me.resolve({nickname:'退出后迟到的旧用户'});summary.resolve({todayCount:8,totalNodes:9,todayAvg:8,streakDays:20});await flush()
 assert.equal(state.cache,null);assert.equal(state.saves.length,0);assert.equal(p.data.userInfo.nickname,undefined);assert.equal(p.data.todayCount,'0/9')
})
test('旧退出请求迟到或旧确认回调不能清除新账号',async()=>{
 const remote=deferred(),{p,state}=harness({logoutRemote:()=>remote.promise});await flush()
 p.onLogout();state.modals[0].success({confirm:true});await flush();state.token='new-account';state.cache={nickname:'新用户'}
 remote.resolve();await flush();assert.equal(state.token,'new-account');assert.equal(state.reset,0);assert.equal(state.cleared,0);assert.equal(state.navs.length,0)
 const other=harness();await flush();other.p.onLogout();other.state.token='second';other.state.modals[0].success({confirm:true});await flush();assert.equal(other.state.calls.filter(c=>c.key==='logoutRemote').length,0)
})
