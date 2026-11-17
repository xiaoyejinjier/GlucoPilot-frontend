const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const pngSource = `data:image/png;base64,${pngBase64}`
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function harness(overrides={}){
  const state={token:'one',timers:new Map(),timeouts:new Map(),now:Date.now(),navs:[],toasts:[],queries:0};let next=0,definition
  const request={getToken:()=>state.token},social={exports:{}}
  const wx={showToast:v=>state.toasts.push(v),redirectTo:v=>state.navs.push(v)}
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'),{module:social,require:()=>request,wx})
  const api={payment:async()=>({orderNo:'SR1',status:'PENDING',amountCents:100,pngBase64,expiresAt:new Date(state.now+900000).toISOString()}),
    refreshPayment:async()=>{state.queries++;return{status:'PENDING',amountCents:100}},...overrides}
  const deps={'../../services/wallet':api,'../../utils/community':social.exports,'../../utils/consultation':require('../../utils/consultation'),
    '../../utils/sandbox-payment':require('../../utils/sandbox-payment'),'../../utils/display':{applyDisplayToCurrentPage(){}}}
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/sandbox-payment/sandbox-payment.js'),'utf8'),{
    Page:v=>definition=v,wx,require:key=>deps[key],getApp:()=>({checkLogin:()=>!!state.token}),
    Date: class extends Date { static now() { return state.now } },
    setInterval:(fn,ms)=>{state.timers.set(++next,{fn,ms});return next},clearInterval:id=>state.timers.delete(id),
    setTimeout:(fn,ms)=>{state.timeouts.set(++next,{fn,ms});return next},clearTimeout:id=>state.timeouts.delete(id)
  })
  const page={...definition,data:structuredClone(definition.data),setData(data){Object.assign(this.data,data)}}
  page.onLoad({orderNo:'SR1'});return{page,state,api}
}
test('内存二维码直接显示，主动查单确认后停止轮询并清除图片',async()=>{
  const h=harness();h.page.onShow();await flush()
  assert.equal(h.page.data.paid,false);assert.equal(h.page.data.qrPath,pngSource)
  assert.equal(h.state.queries,1);assert.equal([...h.state.timers.values()][0].ms,5000)
  h.api.refreshPayment=async()=>({status:'PAID',amountCents:100});await h.page.onRefresh()
  assert.equal(h.page.data.paid,true);assert.equal(h.page.data.qrPath,'');assert.equal(h.state.timers.size,0)
  assert.equal(h.state.timeouts.size,0)
})
test('离开页面停止查单；旧账号的付款码响应不能写入新账号',async()=>{
  let resolve
  const h=harness({payment:()=>new Promise(done=>resolve=done)})
  h.page.onShow();h.page.onHide();h.state.token='two'
  resolve({status:'PENDING',amountCents:100,pngBase64});await flush()
  assert.equal(h.page.data.qrPath,'');assert.equal(h.state.timers.size,0);assert.equal(h.state.queries,0)
})
test('自动查询最长三分钟，暂停后仍允许用户手动查询',async()=>{
  const h=harness();h.page.onShow();await flush();const interval=[...h.state.timers.values()][0]
  for(let i=0;i<36;i++){interval.fn();await flush()}
  assert.equal(h.state.timers.size,0);assert.equal(h.page.data.paused,true)
  const before=h.state.queries;await h.page.onRefresh();assert.equal(h.state.queries,before+1)
  h.page.onHide();assert.equal(h.page.data.qrPath,'')
})
test('付款页不调用微信原生支付或自行标记付款成功',()=>{
  const source=fs.readFileSync(path.join(root,'pages/sandbox-payment/sandbox-payment.js'),'utf8')
  assert.doesNotMatch(source,/requestPayment|setStorageSync/)
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
  assert.ok(manifest.pages.includes('pages/sandbox-payment/sandbox-payment'))
})

test('服务端提示过期时仍可查付款结果，并返回钱包重新确认充值', async () => {
  const h = harness({ payment: async () => {
    throw Object.assign(new Error('支付码已过期，请先查询付款结果后重新下单'), { code: 40900 })
  } })
  h.page.onShow()
  await flush()

  assert.equal(h.page.data.expired, true)
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.qrPath, '')
  assert.equal(h.state.queries, 1)
  assert.equal(h.state.timers.size, 0)
  assert.equal(h.state.timeouts.size, 0)
  assert.equal(h.page.data.price, '1.00')
  h.page.onRecharge()
  assert.equal(h.state.navs[0].url, '/pages/wallet/wallet')
})

test('三分钟自动查单结束后，到期依旧清理旧码，用户手动查单可确认到账', async () => {
  const h = harness()
  h.page.onShow()
  await flush()
  const interval = [...h.state.timers.values()][0]
  const expiry = [...h.state.timeouts.values()][0]
  assert.equal(expiry.ms, 900000)
  for (let i = 0; i < 36; i++) {
    interval.fn()
    await flush()
  }
  assert.equal(h.page.data.paused, true)
  assert.equal(h.state.timeouts.size, 1)
  h.state.now += 900000
  expiry.fn()
  await flush()
  assert.equal(h.page.data.expired, true)
  assert.equal(h.page.data.qrPath, '')
  assert.equal(h.state.timeouts.size, 0)

  h.api.refreshPayment = async () => ({ status: 'PAID', amountCents: 100 })
  await h.page.onRefresh()
  assert.equal(h.page.data.paid, true)
  assert.equal(h.page.data.expired, false)
  assert.equal(h.page.data.error, '')
  h.page.onRecharge()
  assert.equal(h.state.navs.length, 0)
})

test('图片显示失败提供重试，缺少二维码时明确报错，离页清理到期定时器', async () => {
  const h = harness()
  h.page.onShow()
  await flush()
  h.page.onQrError({ currentTarget: { dataset: { generation: h.page.data.qrGeneration - 1 } } })
  assert.equal(h.page.data.qrPath, pngSource)
  h.page.onQrError({ currentTarget: { dataset: { generation: h.page.data.qrGeneration } } })
  assert.equal(h.page.data.qrPath, '')
  assert.match(h.page.data.error, /图片加载失败/)
  await h.page.onRetry()
  assert.equal(h.page.data.qrPath, pngSource)
  h.page.onHide()
  assert.equal(h.state.timeouts.size, 0)

  const missing = harness({ payment: async () => ({
    status: 'PENDING', amountCents: 100, expiresAt: new Date(Date.now() + 900000).toISOString()
  }) })
  missing.page.onShow()
  await flush()
  assert.equal(missing.page.data.loading, false)
  assert.match(missing.page.data.error, /支付码加载失败/)
  assert.equal(missing.state.timers.size, 0)
})

test('支付有效期按东八区解析，已过期的响应不再显示二维码', async () => {
  const { expiryTime } = require('../../utils/sandbox-payment')
  assert.equal(expiryTime('2026-11-13T09:21:00'), Date.parse('2026-11-13T01:21:00Z'))
  assert.equal(expiryTime('2026-11-13 09:21:00'), Date.parse('2026-11-13T01:21:00Z'))
  assert.ok(Number.isNaN(expiryTime('invalid')))

  const h = harness({ payment: async () => ({
    status: 'PENDING', amountCents: 100, pngBase64, expiresAt: '2000-01-01T00:00:00'
  }) })
  h.page.onShow()
  await flush()
  assert.equal(h.page.data.expired, true)
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.qrPath, '')
  assert.equal(h.state.timeouts.size, 0)
})

test('本地文件不可写时仍能生成图片源，PNG内容保持一致', () => {
  const module = { exports: {} }
  let fileCalls = 0
  const wx = { getFileSystemManager() {
    fileCalls++
    throw new Error('writeFile:fail storage unavailable')
  } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/sandbox-payment.js'), 'utf8'), { module, wx })
  const source = module.exports.qrSource(pngBase64)
  assert.equal(source, pngSource)
  assert.deepEqual(Buffer.from(source.split(',')[1], 'base64'), Buffer.from(pngBase64, 'base64'))
  assert.equal(fileCalls, 0)
})

test('错误或超长图片明确报错，账户切换后清除原二维码', async () => {
  const { qrSource } = require('../../utils/sandbox-payment')
  for (const value of [null, 123, '', 'aGVsbG8=', pngBase64 + '!', pngBase64.slice(0, -1), pngBase64.repeat(2500)]) {
    assert.throws(() => qrSource(value), /支付码格式异常/)
  }
  const h = harness()
  h.page.onShow()
  await flush()
  assert.equal(h.page.data.qrPath, pngSource)
  h.page.onHide()
  assert.equal(h.page.data.qrPath, '')
  h.state.token = 'two'
  h.api.payment = async () => { throw new Error('订单不存在') }
  h.page.onShow()
  await flush()
  assert.equal(h.page.data.qrPath, '')
  assert.equal(h.page.data.error, '订单不存在')
})
