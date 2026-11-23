const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const source = fs.readFileSync(path.resolve(__dirname, '../../utils/message-realtime.js'), 'utf8')

function runtime() {
  let sequence = 0
  const state = { token:'one', base:'https://example.test/api/v1', tasks:[], events:[], timers:new Map(), intervals:new Map(), expired:[], now:0 }
  const module = { exports:{} }
  const wx = { setStorageSync(){}, connectSocket(options) {
    const task = { options, sent:[], closed:[], onMessage(fn){this.message=fn},onError(fn){this.error=fn},onClose(fn){this.closeEvent=fn},
      send(value){this.sent.push(JSON.parse(value.data));if(this.failSend)value.fail()}, close(value){this.closed.push(value)} }
    state.tasks.push(task);return task
  } }
  vm.runInNewContext(source, {
    module, wx, getApp:()=>({handleSessionExpired:(...args)=>state.expired.push(args)}),
    require:name=>name==='./config'?{get baseUrl(){return state.base}}:{getToken:()=>state.token,setToken:value=>{state.token=value}},
    Date:{now:()=>state.now},
    setTimeout:(fn,ms)=>{const id=++sequence;state.timers.set(id,{fn,ms});return id},clearTimeout:id=>state.timers.delete(id),
    setInterval:(fn,ms)=>{const id=++sequence;state.intervals.set(id,{fn,ms});return id},clearInterval:id=>state.intervals.delete(id)
  })
  const api = module.exports
  api.subscribe(event=>state.events.push(event))
  const receive = (task, data, code=0) => task.message({data:JSON.stringify({code,message:'test',data,requestId:'trace'})})
  const fire = ms => {const found=[...state.timers].find(([,value])=>value.ms===ms);assert.ok(found,`timer ${ms}`);state.timers.delete(found[0]);found[1].fn()}
  return {api,state,receive,fire}
}

test('共享连接使用当前API的wss和Bearer，READY后才发送并按请求编号确认', async()=>{
  const {api,state,receive}=runtime()
  assert.equal(api.send('2',{content:'x',clientRequestId:'request_1'}),null)
  api.start();api.start();assert.equal(state.tasks.length,1)
  const task=state.tasks[0]
  assert.equal(task.options.url,'wss://example.test/api/v1/community/messages/socket')
  assert.equal(task.options.header.Authorization,'Bearer one');assert.ok(!task.options.url.includes('one'))
  assert.equal(api.connected(),false)
  receive(task,{type:'READY'});assert.equal(api.connected(),true)
  const payload={content:'你好',clientRequestId:'request_1'}, sent=api.send('2',payload)
  assert.equal(api.send('2',payload),sent);assert.equal(task.sent.length,1)
  receive(task,{type:'SENT',clientRequestId:'request_1',message:{id:'1',recipientId:'3'}})
  receive(task,{type:'SENT',clientRequestId:'request_1',message:{id:'1',recipientId:'2'}})
  assert.equal((await sent).id,'1')
  receive(task,{type:'DM_CHANGED',peerUserId:'2',messageId:'1',kind:'MESSAGE'})
  assert.equal(state.events.at(-1).type,'DM_CHANGED')
  api.stop();assert.equal(state.timers.size,0);assert.equal(state.intervals.size,0)
})

test('失去连接拒绝未确认请求，退避重连并触发补拉，迟到旧帧被丢弃', async()=>{
  const {api,state,receive,fire}=runtime();api.start();const old=state.tasks[0];receive(old,{type:'READY'})
  const pending=api.send('2',{content:'x',clientRequestId:'request_1'})
  old.error();await assert.rejects(pending,/未确认/)
  assert.equal(api.connected(),false);assert.equal(state.events.at(-1).type,'DISCONNECTED')
  fire(1000);const next=state.tasks[1];receive(next,{type:'READY'})
  assert.equal(state.events.filter(event=>event.type==='CONNECTED').length,2)
  receive(old,{type:'DM_CHANGED',peerUserId:'2'})
  assert.equal(state.events.at(-1).type,'CONNECTED')
  api.stop()
})

test('退后台关闭连接，换账号和API环境不能回填旧消息、旧401不能退出新账号',()=>{
  const {api,state,receive}=runtime();api.start();const old=state.tasks[0];receive(old,{type:'READY'})
  api.stop();old.closeEvent({code:1000});assert.equal(state.timers.size,0)
  state.token='two';state.base='http://other.test/api/v1';api.start()
  const next=state.tasks[1];assert.equal(next.options.url,'ws://other.test/api/v1/community/messages/socket')
  assert.equal(next.options.header.Authorization,'Bearer two')
  receive(old,{type:'ERROR'},40101);assert.equal(state.token,'two')
  receive(next,{type:'READY'});receive(next,{type:'ERROR'},40101)
  assert.equal(state.token,'');assert.equal(state.expired.length,1);assert.equal(state.timers.size,0)
})

test('业务拒绝保留连接并返回原错误码，确认超时不自动重复发送',async()=>{
  const {api,state,receive,fire}=runtime();api.start();const task=state.tasks[0];receive(task,{type:'READY'})
  const rejected=api.send('2',{content:'x',clientRequestId:'request_1'})
  receive(task,{type:'ERROR',clientRequestId:'request_1'},40301)
  await assert.rejects(rejected,error=>error.code===40301);assert.equal(api.connected(),true)
  const waiting=api.send('2',{content:'y',clientRequestId:'request_2'})
  fire(15000);await assert.rejects(waiting,/未确认/)
  assert.equal(task.sent.length,2);api.stop()
})

test('握手无READY和心跳丢失都重连，正常PONG维持连接',()=>{
  const {api,state,receive,fire}=runtime();api.start();fire(10000)
  fire(1000);const task=state.tasks[1];receive(task,{type:'READY'})
  const beat=[...state.intervals.values()][0];assert.equal(beat.ms,25000)
  state.now=25000;beat.fn();assert.equal(task.sent.at(-1).type,'PING')
  receive(task,{type:'PONG'});state.now=50000;beat.fn();assert.equal(api.connected(),true)
  state.now=90000;beat.fn();assert.equal(api.connected(),false)
  api.stop()
})
