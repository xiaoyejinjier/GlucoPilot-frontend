const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const pageUrl = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay&sign=fixture'
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function harness(overrides = {}, name = 'sandbox-payment') {
  const state = { token: 'one', timers: new Map(), timeouts: new Map(), now: Date.now(),
    navs: [], toasts: [], modals: [], queries: 0, failNavigation: false, failBack: false }
  let next = 0, definition
  const request = { getToken: () => state.token }, social = { exports: {} }
  const wx = {
    showToast: value => state.toasts.push(value),
    showModal: value => state.modals.push(value),
    redirectTo: value => state.navs.push(value),
    navigateTo: value => { state.navs.push(value); if (state.failNavigation) value.fail() },
    navigateBack: value => { state.navs.push(value); if (state.failBack) value.fail() }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/community.js'), 'utf8'), {
    module: social, require: () => request, wx
  })
  const api = {
    payment: async () => ({ orderNo: 'SR1', status: 'PENDING', amountCents: 100,
      paymentMode: 'PAGE', pageUrl, expiresAt: new Date(state.now + 900000).toISOString() }),
    refreshPayment: async () => { state.queries++; return { status: 'PENDING', amountCents: 100 } },
    ...overrides
  }
  const deps = {
    '../../services/wallet': api, '../../utils/community': social.exports,
    '../../utils/consultation': require('../../utils/consultation'),
    '../../utils/sandbox-payment': require('../../utils/sandbox-payment'),
    '../../utils/display': { applyDisplayToCurrentPage() {} }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
    Page: value => { definition = value }, wx, require: key => deps[key],
    getApp: () => ({ checkLogin: () => !!state.token }),
    Date: class extends Date { static now() { return state.now } },
    setInterval: (fn, ms) => { state.timers.set(++next, { fn, ms }); return next },
    clearInterval: id => state.timers.delete(id),
    setTimeout: (fn, ms) => { state.timeouts.set(++next, { fn, ms }); return next },
    clearTimeout: id => state.timeouts.delete(id)
  })
  const page = { ...definition, data: structuredClone(definition.data),
    setData(data, callback) { Object.assign(this.data, data); if (callback) callback() } }
  page.onLoad({ orderNo: 'SR1' })
  return { page, state, api }
}

test('付款按钮只按订单号进入收银台，不在路由或页面暴露长签名链接', async () => {
  const h = harness()
  h.page.onShow(); await flush()
  assert.equal(h.page.data.ready, true)
  assert.equal(h.state.queries, 1)
  h.page.onOpenPayment(); h.page.onOpenPayment()
  assert.equal(h.state.navs.length, 1)
  assert.equal(h.state.navs[0].url, '/pages/sandbox-cashier/sandbox-cashier?orderNo=SR1')
  assert.equal(h.page.data.paid, false)
  assert.ok(!Object.values(h.page.data).includes(pageUrl))
})

test('打开失败可以重试，返回付款页后以服务端查单确认成功', async () => {
  const h = harness()
  h.page.onShow(); await flush()
  h.state.failNavigation = true
  h.page.onOpenPayment()
  assert.equal(h.page.data.opening, false)
  assert.match(h.state.toasts[0].title, /打开失败/)
  h.page.onHide()
  assert.equal(h.state.timers.size, 0)
  assert.equal(h.state.timeouts.size, 0)
  h.api.refreshPayment = async () => ({ status: 'PAID', amountCents: 100 })
  h.page.onShow(); await flush()
  assert.equal(h.page.data.paid, true)
  assert.equal(h.page.data.ready, false)
  h.page.onOpenPayment()
  assert.equal(h.state.navs.length, 1)
})

test('离开或切换账号后，旧付款响应不能恢复付款按钮', async () => {
  let resolve
  const h = harness({ payment: () => new Promise(done => { resolve = done }) })
  h.page.onShow(); h.page.onHide(); h.state.token = 'two'
  resolve({ status: 'PENDING', amountCents: 100, paymentMode: 'PAGE', pageUrl })
  await flush()
  assert.equal(h.page.data.ready, false)
  h.page.onOpenPayment()
  assert.equal(h.state.navs.length, 0)
  assert.equal(h.state.timers.size, 0)
})

test('自动查询最多三分钟，到期后仍允许查单确认迟到的付款结果', async () => {
  const h = harness()
  h.page.onShow(); await flush()
  const timer = [...h.state.timers.values()][0]
  assert.equal(timer.ms, 5000)
  for (let i = 0; i < 36; i++) { timer.fn(); await flush() }
  assert.equal(h.page.data.paused, true)
  assert.equal(h.state.timers.size, 0)
  h.state.now += 900000
  h.page.onOpenPayment()
  assert.equal(h.page.data.expired, true)
  assert.equal(h.state.navs.length, 0)
  h.api.refreshPayment = async () => ({ status: 'PAID', amountCents: 100 })
  await h.page.onRefresh()
  assert.equal(h.page.data.paid, true)
  assert.equal(h.page.data.expired, false)
  assert.equal(h.page.data.error, '')
})

test('旧扫码订单不展示二维码或换渠道付款，仍可查询原付款结果', async () => {
  const h = harness({ payment: async () => ({ status: 'PENDING', paymentMode: 'QR',
    amountCents: 100, pngBase64: 'old-image', expiresAt: new Date(Date.now() + 900000).toISOString() }) })
  h.page.onShow(); await flush()
  assert.equal(h.page.data.legacy, true)
  assert.equal(h.page.data.ready, false)
  assert.equal(h.state.queries, 1)
  h.page.onOpenPayment()
  assert.equal(h.state.navs.length, 0)
  h.page.onRecharge()
  assert.equal(h.state.navs[0].url, '/pages/wallet/wallet')
})

test('过期、非法链接和缺失订单均不能打开收银台', async () => {
  const expired = harness({ payment: async () => { throw Object.assign(new Error('支付码已过期'), { code: 40900 }) } })
  expired.page.onShow(); await flush()
  assert.equal(expired.page.data.expired, true)
  assert.equal(expired.state.queries, 1)
  const invalid = harness({ payment: async () => ({ status: 'PENDING', paymentMode: 'PAGE',
    pageUrl: 'https://other.example/pay', amountCents: 100, expiresAt: new Date(Date.now() + 900000).toISOString() }) })
  invalid.page.onShow(); await flush()
  assert.equal(invalid.page.data.ready, false)
  assert.match(invalid.page.data.error, /付款链接加载失败/)
  const missing = harness()
  missing.page.onLoad({ orderNo: 'bad/id' }); missing.page.onShow(); await flush()
  assert.equal(missing.page.data.error, '订单不存在')
})

test('收银台按当前账号请求本人订单，只渲染官方付款URL', async () => {
  let requested
  const h = harness({ payment: async no => { requested = no; return {
    status: 'PENDING', paymentMode: 'PAGE', pageUrl,
    expiresAt: new Date(Date.now() + 900000).toISOString()
  } } }, 'sandbox-cashier')
  h.page.onShow(); await flush()
  assert.equal(requested, 'SR1')
  assert.equal(h.page.data.cashierUrl, pageUrl)
  assert.equal(h.state.queries, 1)
  h.page.onHide()
  assert.equal(h.page.data.cashierUrl, '')
})

test('微信拦截网页时显示重试与返回，不泄漏签名URL或误标付款成功', async () => {
  const h = harness({}, 'sandbox-cashier')
  h.page.onShow(); await flush()
  h.page.onWebError({ detail: { src: pageUrl, errMsg: 'blocked ' + pageUrl } })
  assert.equal(h.page.data.cashierUrl, '')
  assert.equal(h.page.data.retryable, true)
  assert.match(h.page.data.error, /业务域名/)
  assert.ok(!JSON.stringify(h.page.data).includes('sign=fixture'))
  assert.equal(h.state.queries, 1)
  h.page.onReturn()
  assert.equal(h.state.navs[0].delta, 1)
})

test('收银台忽略旧账号迟到响应，已付、关闭、过期订单不加载网页', async () => {
  let resolve
  const stale = harness({ payment: () => new Promise(done => { resolve = done }) }, 'sandbox-cashier')
  stale.page.onShow(); stale.page.onHide(); stale.state.token = 'two'
  resolve({ status: 'PENDING', paymentMode: 'PAGE', pageUrl, expiresAt: new Date(Date.now() + 900000).toISOString() })
  await flush()
  assert.equal(stale.page.data.cashierUrl, '')
  for (const status of ['PAID', 'CLOSED']) {
    const h = harness({ payment: async () => ({ status, paymentMode: 'PAGE', pageUrl }) }, 'sandbox-cashier')
    h.page.onShow(); await flush()
    assert.equal(h.page.data.cashierUrl, '')
    assert.equal(h.page.data.retryable, false)
  }
  const expired = harness({ payment: async () => ({ status: 'PENDING', paymentMode: 'PAGE', pageUrl,
    expiresAt: '2020-01-01T00:00:00' }) }, 'sandbox-cashier')
  expired.page.onShow(); await flush()
  assert.equal(expired.page.data.cashierUrl, '')
  assert.match(expired.page.data.error, /过期/)
})

test('收银台两秒查单，确认到账后卸载网页并自动返回一次', async () => {
  const h = harness({}, 'sandbox-cashier')
  h.page.onShow(); await flush()
  const timer = [...h.state.timers.values()][0]
  assert.equal(timer.ms, 2000)
  h.api.refreshPayment = async () => ({ status: 'PAID', amountCents: 100 })
  timer.fn(); await flush()
  assert.equal(h.page.data.paid, true)
  assert.equal(h.page.data.cashierUrl, '')
  assert.equal(h.state.timers.size, 0)
  assert.equal(h.state.modals.length, 0)
  assert.equal(h.state.toasts[0].title, '付款成功')
  assert.equal(h.state.navs.length, 1)
  h.page.showCompleted(); await h.page.refreshStatus()
  assert.equal(h.state.modals.length, 0)
  assert.equal(h.state.navs[0].delta, 1)
  h.page.onReturn()
  assert.equal(h.state.navs.length, 1)
})

test('网页加载只能触发查单，待付款和网络失败不会显示到账', async () => {
  const h = harness({}, 'sandbox-cashier')
  h.page.onShow(); await flush()
  const before = h.state.queries
  h.page.onWebLoad({ detail: { src: 'https://example.test/success?paid=true' } })
  await flush()
  assert.equal(h.state.queries, before + 1)
  assert.equal(h.page.data.paid, false)
  assert.equal(h.state.modals.length, 0)
  h.api.refreshPayment = async () => { throw new Error('offline') }
  await h.page.refreshStatus()
  assert.equal(h.page.data.cashierUrl, pageUrl)
  assert.equal(h.page.data.paid, false)
  assert.equal(h.state.modals.length, 0)
})

test('收银台查单互斥、离页停止，旧账号迟到的成功结果不弹提示', async () => {
  let resolve, calls = 0
  const h = harness({ refreshPayment: () => { calls++; return new Promise(done => { resolve = done }) } }, 'sandbox-cashier')
  h.page.onShow(); await flush()
  h.page.onWebLoad(); [...h.state.timers.values()][0].fn()
  assert.equal(calls, 1)
  h.page.onHide(); h.state.token = 'two'
  resolve({ status: 'PAID' }); await flush()
  assert.equal(h.state.timers.size, 0)
  assert.equal(h.page.data.paid, false)
  assert.equal(h.state.modals.length, 0)
  assert.equal(h.state.navs.length, 0)
})

test('关闭订单停止查单，已付订单直接返回且离页不重复导航', async () => {
  const closed = harness({ refreshPayment: async () => ({ status: 'CLOSED' }) }, 'sandbox-cashier')
  closed.page.onShow(); await flush()
  assert.equal(closed.page.data.cashierUrl, '')
  assert.equal(closed.state.timers.size, 0)
  assert.equal(closed.page.data.paid, false)
  const paid = harness({ payment: async () => ({ status: 'PAID' }) }, 'sandbox-cashier')
  paid.page.onShow(); await flush()
  assert.equal(paid.state.navs.length, 1)
  paid.page.onHide(); paid.state.token = 'two'
  paid.page.showCompleted(); paid.page.onReturn()
  assert.equal(paid.state.navs.length, 1)
})

test('收银台轮询到期暂停，页面栈缺失时可返回同一订单付款页', async () => {
  const h = harness({}, 'sandbox-cashier')
  h.page.onShow(); await flush()
  const timer = [...h.state.timers.values()][0]
  h.state.now += 16 * 60000
  timer.fn(); await flush()
  assert.equal(h.state.timers.size, 0)
  h.state.failBack = true
  h.page.onReturn()
  assert.equal(h.state.navs[1].url, '/pages/sandbox-payment/sandbox-payment?orderNo=SR1')
})

test('URL白名单拒绝其他协议、伪装域名、其他支付宝接口和超长链接', () => {
  const { isSandboxPageUrl, expiryTime } = require('../../utils/sandbox-payment')
  assert.equal(isSandboxPageUrl(pageUrl), true)
  for (const url of [null, 'http://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay',
    'https://openapi-sandbox.dl.alipaydev.com.evil.example/gateway.do?method=alipay.trade.page.pay',
    pageUrl.replace('alipay.trade.page.pay', 'alipay.trade.query'), pageUrl + 'x'.repeat(12000)]) {
    assert.equal(isSandboxPageUrl(url), false)
  }
  assert.equal(expiryTime('2026-11-19T10:00:00'), Date.parse('2026-11-19T02:00:00Z'))
})
