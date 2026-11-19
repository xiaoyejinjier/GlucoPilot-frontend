const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const helpers = require('../../utils/wallet')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function harness(name, overrides = {}) {
  const state = { token: 'one', modals: [], toasts: [], navs: [], writes: [], refreshStops: 0 }
  const request = { getToken: () => state.token }
  const wx = { showModal: item => state.modals.push(item), showToast: item => state.toasts.push(item),
    navigateTo: item => state.navs.push(item), stopPullDownRefresh() { state.refreshStops++ } }
  const social = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/community.js'), 'utf8'), {
    module: social, require: () => request, wx, getApp: () => ({})
  })
  const api = { summary: async () => ({ balanceCents: null }),
    orders: async () => ({ records: [], pages: 0 }), detail: async () => ({}),
    recharge: async body => state.writes.push(body), refreshWithdrawals: async () => {}, ...overrides }
  let definition
  const deps = { '../../services/wallet': api, '../../utils/community': social.exports,
    '../../utils/wallet': helpers, '../../utils/withdrawal': require('../../utils/withdrawal'), '../../utils/consultation': require('../../utils/consultation'), '../../utils/display': { applyDisplayToCurrentPage() {} } }
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: item => { definition = item }, require: key => deps[key], wx,
    getApp: () => ({ checkLogin: () => !!state.token })
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(data) { Object.assign(this.data, data) } }
  return { page, state }
}

test('充值金额按整数分转换，边界及精度合法；筹备页面点击不产生资金订单', async () => {
  for (const [input, expected] of [['1',100],['1.01',101],['1000',100000],['0.99',null],['1000.01',null],['1.001',null],['1e2',null],['',null]]) {
    assert.equal(helpers.amountCents(input), expected)
  }
  const { page, state } = harness('wallet', { summary: async () => ({ activated: true }) })
  page.onShow(); await flush()
  page.onCustom({ detail: { value: '0.99' } }); page.onRecharge()
  assert.equal(state.toasts.length, 1)
  page.onAmount({ currentTarget: { dataset: { amount: 10 } } }); page.onRecharge()
  assert.equal(state.modals.length, 1); assert.equal(state.writes.length, 0)
  assert.match(state.modals[0].content, /未创建订单或扣款/)
  page.onHide(); state.token = 'two'; page.onShow(); await flush()
  assert.equal(page.data.custom, ''); assert.equal(page.data.selected, 10)
})

test('未开通钱包先确认开通，状态以本人接口为准，重复点击不重复提交', async () => {
  let activated = false, calls = 0, resolve
  const { page, state } = harness('wallet', { summary: async () => ({ activated }),
    activate: () => { calls++; return new Promise(done => { resolve = done }) } })
  page.onShow(); await flush(); assert.equal(page.data.activated, false)
  page.onRecharge(); assert.equal(state.modals.length, 0)
  page.onActivate(); assert.equal(calls, 0)
  state.modals[0].success({ confirm: true }); await flush()
  page.activateWallet(); assert.equal(calls, 1)
  activated = true; resolve({ activated: true }); await flush()
  assert.equal(page.data.activated, true); assert.equal(state.writes.length, 0)
  page.onHide(); page.onShow(); await flush(); assert.equal(page.data.activated, true)
  page.onHide(); state.token = 'two'; activated = false; page.onShow(); await flush()
  assert.equal(page.data.activated, false)
})

test('医生提现按分提交，失败保留请求编号，金额校验且普通账号不可申请',async()=>{
 const calls=[];let fail=true
 const {page,state}=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,sandbox:true,transferEnabled:true,availableCents:101,frozenCents:0}),withdrawals:async()=>({records:[],pages:0}),
  withdraw:async body=>{calls.push(body);if(fail)throw new Error('网络超时')}
 })
 page.onShow();await flush();assert.equal(page.data.available,'1.01')
 page.onPayee({detail:{value:'2088000000000002'}})
 page.onAmount({detail:{value:'1.001'}});page.onApply();assert.equal(state.modals.length,0)
 page.onAmount({detail:{value:'1.01'}});page.onApply();assert.equal(calls.length,0);assert.match(state.modals[0].content,/沙箱|模拟/)
 state.modals[0].success({confirm:true});await flush();assert.equal(calls[0].amountCents,101);assert.equal(page.data.amount,'1.01')
 fail=false;await page.submit(101);assert.equal(calls[0].clientRequestId,calls[1].clientRequestId);assert.equal(page.data.amount,'')
 page.onHide();state.token='two';page.onShow();await flush();assert.equal(page.data.amount,'')
 const ordinary=harness('doctor-withdrawals',{withdrawalSummary:async()=>({eligible:false,availableCents:0,frozenCents:0}),withdrawals:async()=>({records:[],pages:0})})
 ordinary.page.onShow();await flush();ordinary.page.onApply();assert.equal(ordinary.state.modals.length,0)
})

test('订单类型和状态请求分页，迟到响应不能覆盖新筛选或新账号', async () => {
  const calls = [], pending = []
  const { page, state } = harness('my-orders', { orders: (type, params) => {
    calls.push({ type, params }); return new Promise(resolve => pending.push(resolve))
  } })
  page.onLoad({ type: 'RECHARGE' }); page.onShow(); await flush()
  page.onStatus({ currentTarget: { dataset: { status: 'PAID' } } }); await flush()
  pending[0]({ records: [{ orderNo: 'stale', amountCents: 100 }], pages: 1 }); await flush()
  assert.equal(page.data.records.length, 0)
  pending[1]({ records: [{ orderNo: 'r1', type: 'RECHARGE', amountCents: 101, status: 'PAID' }], pages: 2 }); await flush()
  assert.equal(page.data.records[0].price, '1.01'); assert.equal(calls[1].params.status, 'PAID')
  page.onReachBottom(); await flush(); assert.equal(calls[2].params.pageNum, 2)
  page.onHide(); state.token = 'two'; page.onShow(); await flush()
  pending[2]({ records: [{ orderNo: 'old-account', amountCents: 100 }], pages: 2 }); await flush()
  assert.equal(page.data.records.length, 0)
  pending[3]({ records: [], pages: 0 }); await flush(); assert.equal(page.data.loading, false)
})

test('沙箱充值失败重试沿用同一请求编号，后端确认创建后才进入付款页',async()=>{
  const calls=[];let fail=true
  const {page,state}=harness('wallet',{summary:async()=>({activated:true,sandbox:true,rechargeEnabled:true,balanceCents:1234}),
    recharge:async body=>{calls.push({...body});if(fail)throw new Error('offline');return{orderNo:'SR_test_001'}}})
  page.onShow();await flush();assert.equal(page.data.balance,'12.34')
  page.onRecharge();assert.equal(calls.length,0);state.modals[0].success({confirm:true});await flush()
  assert.equal(calls.length,1);assert.equal(state.navs.length,0)
  fail=false;await page.createRecharge();assert.equal(calls.length,2)
  assert.equal(calls[0].clientRequestId,calls[1].clientRequestId);assert.equal(calls[0].amountCents,1000)
  assert.match(state.navs[0].url,/sandbox-payment.*orderNo=SR_test_001/)
})

test('新充值统一使用网页付款，失败重试保持同一请求编号', async () => {
  const calls = []
  const { page } = harness('wallet', {
    summary: async () => ({ activated: true, sandbox: true, rechargeEnabled: true, balanceCents: 0 }),
    recharge: async body => { calls.push({ ...body }); throw new Error('offline') }
  })
  page.onShow(); await flush()
  await page.createRecharge()
  await page.createRecharge()
  assert.equal(calls[0].paymentMode, 'PAGE')
  assert.equal(calls[0].clientRequestId, calls[1].clientRequestId)
})

test('订单详情只从本人接口加载，404不显示旧数据，订单页面不自动解锁报告', async () => {
  let fail = false
  const { page, state } = harness('order-detail', { detail: async () => {
    if (fail) throw Object.assign(new Error('订单不存在'), { statusCode: 404 })
    return { orderNo: 'c1', type: 'CONSULTATION', status: 'PAID', amountCents: 100 }
  } })
  page.onLoad({ orderNo: 'c1' }); page.onShow(); await flush()
  assert.equal(page.data.order.price, '1.00'); assert.equal(state.navs.length, 0)
  fail = true; await page.load()
  assert.equal(page.data.order, null); assert.equal(page.data.error, '订单不存在')
})

test('提现刷新等待后端查单，随后同步审批、到账状态和冻结金额', async () => {
  let status='PENDING',transferState='NOT_STARTED',frozen=1000,refreshes=0,resolve
  const {page,state}=harness('doctor-withdrawals',{
    withdrawalSummary:async()=>({eligible:true,sandbox:true,transferEnabled:true,availableCents:0,frozenCents:frozen}),
    withdrawals:async()=>({records:[{orderNo:'WD1',amountCents:1000,status,transferState,payeeUserId:'2088000000000002',provider:'ALIPAY_SANDBOX_TRANSFER'}],pages:1}),
    refreshWithdrawals:()=>{refreshes++;return new Promise(done=>{resolve=()=>{status='COMPLETED';transferState='SUCCESS';frozen=0;done()}})}
  })
  page.onShow();await flush();assert.equal(page.data.records[0].statusLabel,'待审核')
  const refreshing=page.onPullDownRefresh();await flush()
  assert.equal(refreshes,1);assert.equal(page.data.loading,true);assert.equal(state.refreshStops,0)
  resolve();await refreshing
  assert.equal(page.data.records[0].statusLabel,'已到账沙箱钱包')
  assert.equal(page.data.frozen,'0.00');assert.equal(state.refreshStops,1)
})

test('刷新失败明确提示，旧账号查单完成后不能刷新新账号记录', async () => {
  let resolve,fail=true
  const {page,state}=harness('doctor-withdrawals',{
    withdrawalSummary:async()=>({eligible:true,sandbox:true,transferEnabled:true,availableCents:1000,frozenCents:0}),
    withdrawals:async()=>({records:[],pages:0}),
    refreshWithdrawals:async()=>{if(fail)throw Error('查单暂不可用');return new Promise(done=>{resolve=done})}
  })
  page.onShow();await flush();await page.onPullDownRefresh()
  assert.equal(page.data.error,'查单暂不可用');assert.equal(page.data.loading,false)
  fail=false;const pending=page.onRefresh();await flush();page.onHide();state.token='two';page.onShow();await flush()
  page.setData({records:[{orderNo:'NEW_ACCOUNT'}]});resolve();await pending
  assert.equal(page.data.records[0].orderNo,'NEW_ACCOUNT')
})

test('绑定旧提现收款UID需要确认，转账开始后入口不再提交修改', async () => {
  const calls=[]
  const {page,state}=harness('doctor-withdrawals',{
    withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:1000}),
    withdrawals:async()=>({records:[{orderNo:'WD1',status:'APPROVED',amountCents:1000,transferStartedAt:null}],pages:1}),
    withdrawalRecipient:async(no,body)=>calls.push({no,body})
  })
  page.onShow();await flush();assert.equal(page.data.records[0].statusLabel,'待补充收款账号')
  page.onBindPayee({currentTarget:{dataset:{order:'WD1'}}});assert.equal(state.modals.length,0)
  page.onPayee({detail:{value:'2088000000000002'}})
  page.onBindPayee({currentTarget:{dataset:{order:'WD1'}}});assert.equal(calls.length,0)
  await state.modals[0].success({confirm:true});assert.equal(calls[0].body.payeeUserId,'2088000000000002')
  page.data.records[0].transferStartedAt='2026-11-18T10:00:00'
  page.onBindPayee({currentTarget:{dataset:{order:'WD1'}}});assert.equal(state.modals.length,1)
})

test('未知转账和历史本地模拟状态不会显示为支付宝到账',()=>{
  const {statusLabel}=require('../../utils/withdrawal')
  assert.equal(statusLabel({status:'APPROVED',payeeUserId:'2088000000000002',transferState:'UNKNOWN'}),'转账待核实')
  assert.equal(statusLabel({status:'COMPLETED',provider:'SANDBOX_SIMULATION'}),'已模拟发放')
  assert.equal(statusLabel({status:'REJECTED',transferState:'FAILED'}),'转账失败，已退回')
})

test('钱包所有接口鉴权并复用API配置，服务失败不能伪装成空列表或余额', async () => {
  const module = { exports: {} }, calls = []
  let fail = false
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/wallet.js'), 'utf8'), {
    module, require: () => ({ get: async (...args) => {
      calls.push(args); if (fail) throw new Error('offline'); return {}
    }, post: async (...args) => calls.push(args) })
  })
  await module.exports.summary(); await module.exports.orders('RECHARGE', { pageNum: 1 })
  await module.exports.orders('CONSULTATION', {}); await module.exports.detail('RECHARGE', 'r1')
  assert.deepEqual(calls.map(item => item[0]), ['/wallet','/wallet/recharge-orders','/consultation-orders','/wallet/recharge-orders/r1'])
  assert.equal(calls.every(item => item[2].auth), true)
  fail = true; await assert.rejects(module.exports.summary(), /offline/)
  await assert.rejects(module.exports.orders('RECHARGE', {}), /offline/)
  const mine = fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8')
  assert.match(mine, /data-url="\/pages\/wallet\/wallet"/)
  assert.match(mine, /data-url="\/pages\/my-orders\/my-orders"/)
})
