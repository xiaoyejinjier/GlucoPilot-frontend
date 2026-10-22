const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const report=(id,state='RESOLVED')=>({id:String(id),targetType:'ARTICLE',targetId:'10',targetTitle:'文章标题',state,resolution:'HIDE_ARTICLE',reason:'SPAM',resolutionNote:'已核查并下架。',createdAt:'2026-10-21T10:00:00',resolvedAt:state==='OPEN'?null:'2026-10-21T11:00:00',feedbackRead:false})
function harness(options={}){
 const state={token:'one',calls:[],navs:[],refresh:0,toasts:[]},wx={setNavigationBarTitle(){},stopPullDownRefresh(){},navigateTo:o=>state.navs.push(o),showToast:o=>state.toasts.push(o),reLaunch:o=>state.navs.push(o)}
 const request={getToken:()=>state.token},social={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'),{module:social,wx,require:()=>request,getApp:()=>({resetLoginState(){}})})
 const impl={fetchMyReports:async()=>({records:[report(1),report(2,'OPEN')],pages:1}),fetchReportFeedback:async id=>report(id),readReportFeedback:async()=>{},...options.api}
 const api=Object.fromEntries(Object.keys(impl).map(key=>[key,(...args)=>{state.calls.push({key,args});return impl[key](...args)}]))
 const deps={'../../services/api':api,'../../utils/community':social.exports,'../../utils/message-notifications':{refresh:()=>state.refresh++},'../../utils/display':{applyDisplayToCurrentPage(){}}}
 let def;vm.runInNewContext(fs.readFileSync(path.join(root,'pages/community-reports/community-reports.js'),'utf8'),{Page:value=>def=value,wx,getApp:()=>({checkLogin:()=>!!state.token}),require:key=>{assert.ok(deps[key],key);return deps[key]}})
 const p={...def,data:JSON.parse(JSON.stringify(def.data)),setData(values,callback){Object.assign(this.data,values);if(callback)callback()}}
 p.onLoad(options.route||{});p.onShow();return{p,state,impl}
}
test('本人举报列表显示处理状态和未读反馈，列表加载不自动已读，点击打开对应详情',async()=>{
 const {p,state}=harness();await flush();assert.equal(p.data.list[0].unread,true);assert.equal(p.data.list[1].unread,false)
 assert.equal(p.data.list[0].resultLabel,'已下架文章');assert.equal(state.calls.filter(c=>c.key==='readReportFeedback').length,0)
 p.onOpen({currentTarget:{dataset:{id:'1'}}});assert.match(state.navs[0].url,/community-reports\?id=1$/);p.onUnload()
})
test('处理详情加载后才标记本条已读并刷新全局，待处理不标记',async()=>{
 const {p,state}=harness({route:{id:'3'}});await flush();assert.equal(p.data.selected.feedbackRead,true);assert.equal(p.data.selected.unread,false);assert.equal(state.refresh,1)
 assert.equal(state.calls.find(c=>c.key==='readReportFeedback').args[0],'3');p.onUnload()
 const pending=harness({route:{id:'4'},api:{fetchReportFeedback:async()=>report(4,'OPEN')}});await flush();assert.equal(pending.state.calls.some(c=>c.key==='readReportFeedback'),false);pending.p.onUnload()
})
test('已读失败保留反馈并可重试，换账号或隐藏后迟到详情不能回填',async()=>{
 let fail=true;const current=harness({route:{id:'3'},api:{readReportFeedback:async()=>{if(fail)throw new Error('网络异常')}}});await flush()
 assert.equal(current.p.data.readError,true);assert.equal(current.p.data.selected.unread,true);assert.equal(current.state.refresh,0)
 fail=false;await current.p.markRead();assert.equal(current.p.data.readError,false);assert.equal(current.state.refresh,1);current.p.onUnload()
 const slow=defer(),late=harness({route:{id:'5'},api:{fetchReportFeedback:()=>slow.promise}});late.p.onHide();late.state.token='two';slow.resolve(report(5));await flush()
 assert.equal(late.p.data.selected,null);assert.equal(late.state.calls.some(c=>c.key==='readReportFeedback'),false);late.p.onUnload()
})
test('举报列表分页保留已有条目并去重，切账号立即清空旧举报',async()=>{
 const {p,state,impl}=harness({api:{fetchMyReports:async q=>({records:[report(q.pageNum),report(q.pageNum+1)],pages:2})}});await flush();await p.onMore()
 assert.equal(p.data.list.map(row=>row.id).join(','),'1,2,3');p.onHide();state.token='two';impl.fetchMyReports=()=>new Promise(()=>{});p.onShow();assert.equal(p.data.list.length,0);p.onUnload()
})
