const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function moduleAt(file, dependencies, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, require(name) { assert.ok(dependencies[name], name); return dependencies[name] }, ...globals
  })
  return module.exports
}
function vaultRuntime() {
  const values = new Map(), config = { baseUrl: 'https://one.example.test/api/v1' }
  const wx = { getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key) }
  const vault = moduleAt('utils/account-vault.js', { './config': config }, { wx })
  return { vault, values, config, wx }
}
function profile(id) { return { communityKey: id, nickname: id, phone: '13800000001', accountStatus: 1, medicalHistory: 'private-health' } }

test('账号仅保存显示资料和会话，公开列表不含令牌/完整手机号/健康资料；身份以审核结果为准', () => {
  const h = vaultRuntime()
  h.vault.remember(profile('u1'), 'token-one', 'APPROVED')
  h.vault.remember(profile('u2'), 'token-two', 'PENDING')
  const rows = h.vault.list('token-one')
  assert.equal(rows.find(r => r.id === 'u1').roleLabel, '医生账号')
  assert.equal(rows.find(r => r.id === 'u2').roleLabel, '普通账号')
  assert.equal(rows.find(r => r.id === 'u1').current, true)
  assert.equal(rows.find(r => r.id === 'u1').phoneMasked, '138****0001')
  assert.ok(!JSON.stringify(rows).includes('token-one'))
  assert.ok(!JSON.stringify(rows).includes('13800000001'))
  assert.ok(!JSON.stringify([...h.values.values()]).includes('private-health'))
  h.vault.remember(profile('u1'), 'token-one')
  assert.equal(h.vault.session('u1').role, 'DOCTOR')
  h.vault.remember(profile('u1'), 'token-one', 'DISABLED')
  assert.equal(h.vault.session('u1').role, 'USER')
})

test('会话按服务器隔离、限制五个账号，注销只使对应令牌失效', () => {
  const h = vaultRuntime()
  for (let id = 1; id <= 7; id++) h.vault.remember(profile('u' + id), 'token-' + id, null)
  assert.equal(h.vault.list().length, 5)
  const target = h.vault.list()[0].id, token = h.vault.session(target).token
  h.vault.invalidateToken(token)
  assert.equal(h.vault.session(target).token, '')
  assert.equal(h.vault.list().filter(r => r.requiresLogin).length, 1)
  h.config.baseUrl = 'https://two.example.test/api/v1'
  assert.equal(h.vault.list().length, 0)
  h.vault.remember(profile('u1'), 'second-server')
  h.config.baseUrl = 'https://one.example.test/api/v1/'
  assert.equal(h.vault.list().length, 5)
  assert.ok(!h.vault.list().some(r => h.vault.session(r.id).token === 'second-server'))
})

test('本地存储失败不影响登录，损坏缓存和无身份资料不生成可切换账号', () => {
  const h = vaultRuntime()
  h.vault.remember(null, 'token')
  h.vault.remember({ communityKey: 'u0' }, 'token')
  assert.equal(h.vault.list().length, 0)
  h.wx.setStorageSync = () => { throw Error('storage full') }
  assert.doesNotThrow(() => h.vault.remember(profile('u1'), 'token'))
  assert.equal(h.vault.list().length, 0)
})

test('切换校验使用候选会话鉴权且不触发当前账号的401处理，并核对身份及状态', async () => {
  const calls = []; let raw = profile('u2')
  const api = moduleAt('services/accounts.js', {
    '../utils/request': { async get(url, data, options) { calls.push({ url, options }); return url === '/users/me' ? raw : { status: 'APPROVED' } } },
    '../utils/mappers': { mapUserMe: value => value }
  })
  assert.equal((await api.inspect('candidate', 'u2')).doctorStatus, 'APPROVED')
  for (const call of calls) { assert.equal(call.options.auth, false); assert.equal(call.options.header.Authorization, 'Bearer candidate') }
  await assert.rejects(api.inspect('candidate', 'u3'), e => e.code === 40100)
  raw = { ...raw, accountStatus: 0 }
  await assert.rejects(api.inspect('candidate', 'u2'), e => e.code === 40300)
  await assert.rejects(api.inspect('', 'u2'), e => e.code === 40100)
})

function pageRuntime(inspect) {
  const h = vaultRuntime()
  let token = 'old', definition
  const events = []
  h.vault.remember(profile('u1'), 'old', null)
  h.vault.remember(profile('u2'), 'new', 'APPROVED')
  const app = { globalData: { isLoggedIn: true, userInfo: profile('u1') },
    resetLoginState(options) { events.push(['reset', options]); token = ''; this.globalData.isLoggedIn = false; this.globalData.userInfo = null },
    async goAfterLogin() { events.push(['afterLogin', token]) } }
  const request = { getToken: () => token, setToken: value => { token = value } }
  const wx = { ...h.wx, showToast: value => events.push(['toast', value]), reLaunch: value => events.push(['route', value.url]) }
  moduleAt('pages/account-switch/account-switch.js', {
    '../../utils/account-vault': h.vault,
    '../../services/accounts': { inspect: inspect || (async (value, id) => ({ token: value, profile: profile(id || 'u1'), doctorStatus: 'APPROVED' })) },
    '../../utils/request': request,
    '../../utils/storage': { getUserInfo: () => app.globalData.userInfo, clearAccountCache() { events.push(['clear']); token = '' }, login(info) { events.push(['login', info.communityKey]) } },
    '../../utils/display': { applyDisplayToCurrentPage() {} }
  }, { Page: value => { definition = value }, getApp: () => app, wx })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value) } }
  // Enter without automatic role refresh, so preflight can be controlled precisely.
  page._visible = true; page._epoch = 1; page._token = token; page._scope = h.vault.scope()
  return { ...h, page, app, request, events }
}
const select = page => page.onSelect({ currentTarget: { dataset: { id: 'u2' } } })

test('切换先校验后清理并启用目标会话，重复点击只执行一次，保留原账号', async () => {
  const pending = deferred(); let calls = 0
  const h = pageRuntime(() => { calls++; return pending.promise })
  const action = select(h.page)
  await select(h.page)
  assert.equal(calls, 1)
  assert.equal(h.request.getToken(), 'old')
  assert.equal(h.events.length, 0)
  pending.resolve({ token: 'new', profile: profile('u2'), doctorStatus: 'APPROVED' })
  await action
  assert.equal(h.request.getToken(), 'new')
  assert.equal(h.app.globalData.userInfo.communityKey, 'u2')
  assert.equal(h.vault.session('u1').token, 'old')
  assert.deepEqual(h.events.map(e => e[0]), ['reset', 'clear', 'login', 'afterLogin'])
  assert.ok(!JSON.stringify(h.page.data).includes('"token"'))
})

test('网络校验失败保留当前登录；候选会话失效则带手机号重新登录而不发送验证码', async () => {
  const network = pageRuntime(async () => { throw Error('network unavailable') })
  await select(network.page)
  assert.equal(network.request.getToken(), 'old')
  assert.equal(network.page.data.error, 'network unavailable')
  assert.equal(network.events.length, 0)
  const expired = pageRuntime(async () => { throw Object.assign(Error('expired'), { code: 40100 }) })
  await select(expired.page)
  assert.equal(expired.vault.session('u2').token, '')
  assert.equal(expired.vault.session('u1').token, 'old')
  assert.equal(expired.app.globalData.pendingLoginPhone, '13800000001')
  assert.ok(expired.events.some(e => e[0] === 'route' && e[1] === '/pages/login/login'))
})

for (const change of ['hide', 'token', 'server']) test('校验晚到时不覆盖已变化的上下文：' + change, async () => {
  const pending = deferred(), h = pageRuntime(() => pending.promise)
  const action = select(h.page)
  if (change === 'hide') h.page.onHide()
  if (change === 'token') h.request.setToken('third-account')
  if (change === 'server') h.config.baseUrl = 'https://other.example.test/api/v1'
  pending.resolve({ token: 'new', profile: profile('u2'), doctorStatus: 'APPROVED' })
  await action
  assert.equal(h.events.length, 0)
  assert.equal(h.request.getToken(), change === 'token' ? 'third-account' : 'old')
})

test('添加账号保留旧会话，身份刷新只在当前页面和服务器上下文写入', async () => {
  const h = pageRuntime()
  await h.page.load()
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.accounts.find(r => r.id === 'u2').roleLabel, '医生账号')
  h.page.onAddAccount()
  assert.equal(h.vault.session('u1').token, 'old')
  assert.equal(h.vault.session('u2').token, 'new')
  assert.equal(h.request.getToken(), '')
  assert.equal(h.app.globalData.accountSwitchFlow, true)
  assert.ok(h.events.some(e => e[0] === 'route'))
})

test('旧账号的云同步响应不写入新账号节流状态', async () => {
  const pending = deferred(); let token = 'old'; const writes = []
  const api = moduleAt('utils/device-cloud-sync.js', {
    './request': { getToken: () => token }, '../services/api': { pullDeviceCloud: () => pending.promise }
  }, { getApp: () => ({ globalData: { isLoggedIn: true } }), wx: { getStorageSync: () => 0, setStorageSync: (...args) => writes.push(args) } })
  const action = api.tryAutoCloudPull()
  token = 'new'; pending.resolve({ imported: 1 })
  assert.equal(await action, null)
  assert.equal(writes.length, 0)
})
