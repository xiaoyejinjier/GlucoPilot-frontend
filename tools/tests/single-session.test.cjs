const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function runtime() {
  const storage = new Map([['accessToken', 'old-token'], ['isLoggedIn', true]])
  const calls = [], expirations = []
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => calls.push(options)
  }
  const app = { handleSessionExpired(token, message) { expirations.push({ token, message }); return true } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8'), {
    module, wx, getApp: () => app,
    require: () => ({ baseUrl: 'https://api.example.test/api/v1', connectionIssue: () => '' })
  })
  return { storage, calls, expirations, request: module.exports }
}

test('被另一终端替换的会话清理当前登录并交给全局提示，保留原业务码', async () => {
  const h = runtime()
  const first = h.request.get('/users/me')
  const second = h.request.get('/community/notifications/summary')
  const rejected = [first, second].map(promise => assert.rejects(promise, error =>
    error.code === 40100 && error.body.code === 40101))
  for (const call of h.calls) call.success({ statusCode: 401, data: {
    code: 40101, message: '账号已在其他终端登录，请重新登录', requestId: 'session-test'
  } })
  await Promise.all(rejected)
  assert.equal(h.storage.has('accessToken'), false)
  assert.equal(h.storage.get('isLoggedIn'), false)
  assert.equal(h.expirations.length, 1)
  assert.equal(h.expirations[0].token, 'old-token')
})

test('旧请求迟到的401不能清除刚登录的新令牌', async () => {
  const h = runtime()
  const pending = h.request.get('/users/me')
  const rejected = assert.rejects(pending, error => error.code === 40100 && !error.sessionHandled)
  h.storage.set('accessToken', 'new-token')
  h.calls[0].success({ statusCode: 401, data: { code: 40101 } })
  await rejected
  assert.equal(h.storage.get('accessToken'), 'new-token')
  assert.equal(h.storage.get('isLoggedIn'), true)
  assert.equal(h.expirations.length, 0)
})

test('登录接口自身的401不清除已有令牌，普通鉴权过期仍进入统一处理', async () => {
  const h = runtime()
  const pending = h.request.post('/auth/wechat/sessions', { code: 'test' }, { auth: false })
  const rejected = assert.rejects(pending, /登录服务暂不可用/)
  h.calls[0].success({ statusCode: 401, data: { code: 40100 } })
  await rejected
  assert.equal(h.storage.get('accessToken'), 'old-token')
  assert.equal(h.expirations.length, 0)
  const profile = h.request.get('/users/me')
  const expired = assert.rejects(profile, error => error.sessionHandled && error.code === 40100)
  h.calls[1].success({ statusCode: 401, data: { code: 40100 } })
  await expired
  assert.equal(h.expirations.length, 1)
})
