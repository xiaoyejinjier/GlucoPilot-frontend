const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')

test('问诊未读纳入全局数量，新消息只提示一次，当前聊天页不重复弹提示',async()=>{
  const app={globalData:{}},toasts=[],module={exports:{}}
  let state={total:2,consultations:2,latestConsultationMessageId:'7'},route='pages/ai/ai'
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../utils/message-notifications.js'),'utf8'),{
    module,require:name=>name==='../services/api'?{fetchInformationSummary:async()=>state}:{getToken:()=> 'same-user'},
    getApp:()=>app,getCurrentPages:()=>[{route,setData(){}}],wx:{showToast:value=>toasts.push(value)},setInterval:()=>1,clearInterval(){}
  })
  const notifications=module.exports
  notifications.start();for(let i=0;i<15;i++)await Promise.resolve()
  assert.equal(app.globalData.unreadCount,2);assert.equal(app.globalData.informationCounts.consultations,2)
  assert.match(toasts[0].title,/问诊/)
  await notifications.refresh();assert.equal(toasts.length,1)
  route='pages/consultation-chat/consultation-chat';state={total:3,consultations:3,latestConsultationMessageId:'8'}
  await notifications.refresh();assert.equal(toasts.length,1)
  state={total:0,consultations:0};await notifications.refresh(true);assert.equal(app.globalData.unreadCount,0)
  notifications.stop()
})
test('用户标记已读后的强制刷新使在途旧汇总失效，不恢复红点或新私信弹窗',async()=>{
  const pending=[],toasts=[],app={globalData:{}},module={exports:{}}
  const api={fetchInformationSummary:()=>new Promise(resolve=>pending.push(resolve))}
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../utils/message-notifications.js'),'utf8'),{
    module,require:name=>name==='../services/api'?api:{getToken:()=> 'same-user'},getApp:()=>app,getCurrentPages:()=>[],
    wx:{showToast:value=>toasts.push(value)},setInterval:()=>1,clearInterval(){}
  })
  const notifications=module.exports
  notifications.start();assert.equal(pending.length,1)
  const current=notifications.refresh(true);assert.equal(pending.length,2)
  pending[1]({total:0,messages:0});await current
  pending[0]({total:1,messages:1,latestMessageId:'99',latestSenderId:'2'})
  for(let i=0;i<15;i++)await Promise.resolve()
  assert.equal(app.globalData.unreadCount,0);assert.equal(toasts.length,0)
  notifications.stop()
})
