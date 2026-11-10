const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
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
