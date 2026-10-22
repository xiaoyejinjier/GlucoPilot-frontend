const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname,'../..')
const flush = async () => { for(let i=0;i<15;i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done=>resolve=done); return {promise,resolve} }
function harness(combined=false) {
  const state={token:'one',toasts:[],queue:[],timers:new Map(),calls:0}
  const tab={setData(data){Object.assign(this,data)}}, page={route:'pages/index/index',data:{},setData(data){Object.assign(this.data,data)},getTabBar:()=>tab}
  const app={globalData:{unreadCount:0}}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/message-notifications.js'),'utf8'),{
    module,getApp:()=>app,getCurrentPages:()=>[page],wx:{showToast:value=>state.toasts.push(value)},
    require:key=>key==='./request'?{getToken:()=>state.token}:{[combined?'fetchInformationSummary':'fetchUnreadMessages'](){state.calls++;return state.queue.length?state.queue.shift():Promise.resolve({unreadCount:0})}},
    setInterval:(fn,ms)=>{assert.equal(ms,5000);state.timers.set(1,fn);return 1},clearInterval:id=>state.timers.delete(id)
  })
  return {notifications:module.exports,state,page,tab,app}
}
test('全会话未读提示不含正文、无0角标，读后更新且不会把回退的MAX ID当新消息',async()=>{
  const {notifications:n,state,page,tab}=harness()
  state.queue.push(Promise.resolve({unreadCount:'2',latestMessageId:'100',latestSenderId:'2'}));n.start();await flush()
  assert.equal(page.data.unreadLabel,'2');assert.equal(tab.unreadCount,2);assert.equal(state.toasts.length,1)
  state.queue.push(Promise.resolve({unreadCount:'1',latestMessageId:'99',latestSenderId:'3'}));await n.refresh();assert.equal(state.toasts.length,1)
  state.queue.push(Promise.resolve({unreadCount:'0',latestMessageId:null}));await n.refresh();assert.equal(page.data.unreadLabel,'');assert.equal(tab.unreadCount,0)
  state.queue.push(Promise.resolve({unreadCount:120,latestMessageId:'101',latestSenderId:'3'}));await n.refresh();assert.equal(page.data.unreadLabel,'99+');assert.equal(state.toasts.length,2)
  n.stop();assert.equal(state.timers.size,0)
})

test('全局角标同时汇总五类信息，读后归零并保留类别数量供记录页显示',async()=>{
  const {notifications:n,state,page,tab}=harness(true)
  state.queue.push(Promise.resolve({messages:1,likes:2,collections:0,comments:3,follows:1,total:7,latestNotificationId:'8'}));n.start();await flush()
  assert.equal(tab.unreadCount,7);assert.equal(page.data.informationCounts.likes,2);assert.equal(page.data.informationCounts.collections,0);assert.equal(state.toasts.length,1)
  state.queue.push(Promise.resolve({messages:0,likes:0,collections:0,comments:0,follows:0,total:0}));await n.refresh();assert.equal(page.data.unreadLabel,'');assert.equal(page.data.informationCounts.total,0);n.stop()
})
test('当前聊天不重复提示，后台不轮询，换账号丢弃迟到数据并重置提醒游标',async()=>{
  const {notifications:n,state,page}=harness()
  page.route='pages/messages/messages';page._peer='2'
  state.queue.push(Promise.resolve({unreadCount:1,latestMessageId:'900',latestSenderId:'2'}));n.start();await flush();assert.equal(state.toasts.length,0)
  const old=deferred();state.queue.push(old.promise);const running=n.refresh();n.stop();const count=state.calls;await n.refresh();assert.equal(state.calls,count)
  page.route='pages/index/index';state.token='two'
  state.queue.push(Promise.resolve({unreadCount:1,latestMessageId:'5',latestSenderId:'3'}));n.start();await flush()
  old.resolve({unreadCount:999,latestMessageId:'999',latestSenderId:'4'});await running
  assert.equal(page.data.unreadCount,1);assert.equal(state.toasts.length,1)
  state.token='';await n.refresh();assert.equal(page.data.unreadLabel,'');assert.equal(state.timers.size,0)
})

test('举报反馈计入全局数量，查看后归零，不把已读回退的编号重复弹出',async()=>{
  const {notifications:n,state,page,tab}=harness(true)
  state.queue.push(Promise.resolve({messages:0,reports:2,total:2,latestReportId:'10'}));n.start();await flush()
  assert.equal(page.data.informationCounts.reports,2);assert.equal(tab.unreadCount,2);assert.match(state.toasts.at(-1).title,/举报/)
  state.queue.push(Promise.resolve({reports:1,total:1,latestReportId:'9'}));await n.refresh();assert.equal(state.toasts.length,1)
  state.queue.push(Promise.resolve({reports:0,total:0}));await n.refresh();assert.equal(page.data.unreadLabel,'');assert.equal(tab.unreadCount,0)
  page.route='pages/community-reports/community-reports';state.queue.push(Promise.resolve({reports:1,total:1,latestReportId:'11'}));await n.refresh();assert.equal(state.toasts.length,1);n.stop()
})
