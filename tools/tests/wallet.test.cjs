const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const helpers = require('../../utils/wallet')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

test('订单余额展示历史快照，零余额正常，缺失及非法值不转换为零',()=>{
 for(const [raw,expected] of [[0,'0.00'],[101,'1.01'],['1234','12.34'],[null,null],[undefined,null],['',null],[-1,null],[1.5,null],[Number.MAX_SAFE_INTEGER+1,null]]){
  const row=helpers.decorate({type:'RECHARGE',status:'PAID',amountCents:100,balanceAfterCents:raw})
  assert.equal(row.balanceAfter,expected);assert.equal(row.showBalanceAfter,true)
  assert.equal(row.balanceAfterLabel,'充值后余额')
 }
 assert.equal(helpers.decorate({type:'CONSULTATION',status:'PAID',balanceAfterCents:0}).balanceAfterLabel,'支付后余额')
 for(const status of ['PENDING','CLOSED','REFUNDING','REFUNDED'])
  assert.equal(helpers.decorate({status,balanceAfterCents:1234}).showBalanceAfter,false)
})

test('充值和问诊列表与详情读取同一历史余额，不使用当前钱包余额补齐旧订单',async()=>{
 for(const type of ['RECHARGE','CONSULTATION']){
  const row={orderNo:'order-test',type,status:'PAID',amountCents:100,balanceAfterCents:0}
  const api={orders:async()=>({records:[row],pages:1}),detail:async()=>row,
   summary:async()=>{throw Error('不应读取当前余额代替历史快照')}}
  const list=harness('my-orders',api);list.page.onLoad({type});list.page.onShow();await flush()
  assert.equal(list.page.data.records[0].balanceAfter,'0.00')
  const detail=harness('order-detail',api);detail.page.onLoad({type,orderNo:row.orderNo});detail.page.onShow();await flush()
  assert.equal(detail.page.data.order.balanceAfter,'0.00')
  row.balanceAfterCents=null;await list.page.onPullDownRefresh();await detail.page.onPullDownRefresh()
  assert.equal(list.page.data.records[0].balanceAfter,null);assert.equal(detail.page.data.order.balanceAfter,null)
 }
})

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
    recharge: async body => state.writes.push(body), refreshWithdrawals: async () => {}, defaultWithdrawalRecipient: async () => ({payeeUserId:null,source:'NONE'}), ...overrides }
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
 page.onAmount({detail:{value:'1.01'}});page.onApply();assert.equal(calls.length,0);assert.match(state.modals[0].content,/冻结对应问诊收入/);assert.match(state.modals[0].content,/第5个工作日/)
 state.modals[0].success({confirm:true});await flush();assert.equal(calls[0].amountCents,101);assert.equal(page.data.amount,'1.01')
 fail=false;await page.submit(101);assert.equal(calls[0].clientRequestId,calls[1].clientRequestId);assert.equal(page.data.amount,'')
 page.onHide();state.token='two';page.onShow();await flush();assert.equal(page.data.amount,'')
 const ordinary=harness('doctor-withdrawals',{withdrawalSummary:async()=>({eligible:false,availableCents:0,frozenCents:0}),withdrawals:async()=>({records:[],pages:0})})
 ordinary.page.onShow();await flush();ordinary.page.onApply();assert.equal(ordinary.state.modals.length,0)
})

test('提现自动带入本人历史或已核实充值账号，不用手填即可确认申请',async()=>{
 for(const source of ['HISTORY','RECHARGE']){
  const writes=[],h=harness('doctor-withdrawals',{
   withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:100,frozenCents:0}),withdrawals:async()=>({records:[],pages:0}),
   defaultWithdrawalRecipient:async()=>({payeeUserId:'2088000000000002',source}),withdraw:async body=>writes.push(body)
  });h.page.onShow();await flush()
  assert.equal(h.page.data.payeeUserId,'2088000000000002');assert.equal(h.page.data.payeeEditing,false);assert.equal(h.page.data.payeeMasked,'2088 **** 0002')
  h.page.onAmount({detail:{value:'1'}});h.page.onApply();h.state.modals[0].success({confirm:true});await flush()
  assert.equal(writes[0].payeeUserId,'2088000000000002');assert.equal(writes[0].amountCents,100)
 }
})

test('自动识别失败不影响金额和记录，手动输入及换账号后不被迟到账号覆盖',async()=>{
 let resolve;const h=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:200,frozenCents:0}),withdrawals:async()=>({records:[],pages:0}),
  defaultWithdrawalRecipient:()=>new Promise(done=>{resolve=done})
 });h.page.onShow();await flush();assert.equal(h.page.data.available,'2.00');assert.equal(h.page.data.payeeLoading,true)
 h.page.onChangePayee();h.page.onPayee({detail:{value:'2088000000000003'}});resolve({payeeUserId:'2088000000000002',source:'RECHARGE'});await flush()
 assert.equal(h.page.data.payeeUserId,'2088000000000003')
 const pending=h.page.onResolvePayee();h.page.onHide();h.state.token='two';resolve({payeeUserId:'2088000000000002',source:'HISTORY'});await pending
 assert.equal(h.page.data.payeeUserId,'2088000000000003','旧账号识别结果不能写入其他会话')
 h.page.onShow();await flush();assert.equal(h.page.data.payeeUserId,'')
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
  assert.equal(page.data.records[0].statusLabel,'已到账')
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

test('修改提现账号使用可编辑弹窗和当前记录账号，不依赖新申请账号', async () => {
  const calls=[];let payee='2088000000000002'
  const {page,state}=harness('doctor-withdrawals',{
    withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:1000}),
    withdrawals:async()=>({records:[{orderNo:'WD1',status:'APPROVED',amountCents:1000,payeeUserId:payee,transferState:'NOT_STARTED',transferStartedAt:null}],pages:1}),
    withdrawalRecipient:async(no,body)=>{calls.push({no,body});payee=body.payeeUserId}
  })
  page.onShow();await flush();assert.equal(page.data.records[0].canEditRecipient,true)
  // 上方新申请账号与当前提现不同，弹窗也必须带入当前记录的账号。
  page.onPayee({detail:{value:'2088000000000009'}})
  const event={currentTarget:{dataset:{order:'WD1'}}}
  page.onBindPayee(event);page.onBindPayee(event);assert.equal(state.modals.length,1)
  const dialog=state.modals[0];assert.equal(dialog.editable,true);assert.equal(dialog.title,'修改收款账号');assert.equal(dialog.content,payee)
  await dialog.success({confirm:true,content:' 2088000000000003 '})
  assert.equal(calls.length,1);assert.equal(calls[0].no,'WD1');assert.equal(calls[0].body.payeeUserId,'2088000000000003')
  assert.equal(page.data.records[0].payeeUserId,'2088000000000003');assert.equal(page.data.payeeUserId,'2088000000000009')
  await dialog.success({confirm:true,content:'2088000000000004'});assert.equal(calls.length,1)
})

test('未绑定提现可直接输入账号，取消或非法UID不提交，原账号不变不重复保存',async()=>{
 let payee='';const calls=[]
 const h=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:100}),
  withdrawals:async()=>({records:[{orderNo:'WD2',status:'PENDING',amountCents:100,payeeUserId:payee}],pages:1}),
  withdrawalRecipient:async(no,body)=>{calls.push({no,body});payee=body.payeeUserId}
 })
 h.page.onShow();await flush();const click=()=>h.page.onBindPayee({currentTarget:{dataset:{order:'WD2'}}})
 click();assert.equal(h.state.modals.at(-1).content,'');assert.equal(h.state.modals.at(-1).title,'补充收款账号')
 await h.state.modals.at(-1).success({cancel:true});assert.equal(calls.length,0)
 click();await h.state.modals.at(-1).success({confirm:true,content:'12345678901'});assert.equal(calls.length,0);assert.match(h.state.toasts.at(-1).title,/有效/)
 click();await h.state.modals.at(-1).success({confirm:true,content:'2088000000000002'});assert.equal(calls.length,1)
 click();await h.state.modals.at(-1).success({confirm:true,content:'2088000000000002'});assert.equal(calls.length,1)
})

test('已发放、已结束及转账中或待核实记录都不能修改收款账号',async()=>{
 const rows=[
  {status:'COMPLETED'}, {status:'REJECTED'}, {status:'CLOSED'},
  {status:'APPROVED',transferStartedAt:'2026-11-24T10:00:00'},
  ...['PROCESSING','WAITING','UNKNOWN','SUCCESS','FAILED'].map(transferState=>({status:'APPROVED',transferState})),
  {status:'APPROVED',payoutReference:'payout-ref'}
 ].map((row,i)=>({orderNo:'WD'+i,amountCents:100,...row}))
 const h=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:0}),
  withdrawals:async()=>({records:rows,pages:1})
 })
 h.page.onShow();await flush()
 for(const row of h.page.data.records){assert.equal(row.canEditRecipient,false);h.page.onBindPayee({currentTarget:{dataset:{order:row.orderNo}}})}
 assert.equal(h.state.modals.length,0)
})

test('编辑期间开始发放会拒绝保存，远端冲突后刷新并隐藏修改按钮',async()=>{
 let status='APPROVED';let calls=0
 const h=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:100}),
  withdrawals:async()=>({records:[{orderNo:'WD3',status,amountCents:100,payeeUserId:'2088000000000002'}],pages:1}),
  withdrawalRecipient:async()=>{calls++;status='COMPLETED';throw Object.assign(new Error('提现订单已更新'),{code:40900})}
 })
 h.page.onShow();await flush();const click=()=>h.page.onBindPayee({currentTarget:{dataset:{order:'WD3'}}})
 click();h.page.data.records[0].status='COMPLETED'
 await h.state.modals.at(-1).success({confirm:true,content:'2088000000000003'});assert.equal(calls,0)
 h.page.data.records[0].status='APPROVED';click()
 await h.state.modals.at(-1).success({confirm:true,content:'2088000000000003'})
 assert.equal(calls,1);assert.equal(h.page.data.records[0].status,'COMPLETED');assert.equal(h.page.data.records[0].canEditRecipient,false)
 click();assert.equal(h.state.modals.length,2)
})

test('失败后保留本页收款账号草稿，换账号或离页后的弹窗不能提交',async()=>{
 const calls=[]
 const h=harness('doctor-withdrawals',{
  withdrawalSummary:async()=>({eligible:true,transferEnabled:true,availableCents:0,frozenCents:100}),
  withdrawals:async()=>({records:[{orderNo:'WD4',status:'APPROVED',amountCents:100,payeeUserId:'2088000000000002'}],pages:1}),
  withdrawalRecipient:async(no,body)=>{calls.push({no,body});throw new Error('offline')}
 })
 h.page.onShow();await flush();const click=()=>h.page.onBindPayee({currentTarget:{dataset:{order:'WD4'}}})
 click();await h.state.modals.at(-1).success({confirm:true,content:'2088000000000003'});assert.equal(calls.length,1);assert.equal(h.page.data.posting,false)
 click();assert.equal(h.state.modals.at(-1).content,'2088000000000003')
 const stale=h.state.modals.at(-1);h.page.onHide();h.state.token='two';h.page.onShow();await flush()
 await stale.success({confirm:true,content:'2088000000000004'});assert.equal(calls.length,1)
 click();assert.equal(h.state.modals.at(-1).content,'2088000000000002')
 const hidden=h.state.modals.at(-1);h.page.onHide();await hidden.success({confirm:true,content:'2088000000000005'});assert.equal(calls.length,1)
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
