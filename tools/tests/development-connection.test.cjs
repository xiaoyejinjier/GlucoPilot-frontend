const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function connection({ platform = 'ios', version = 'develop', storage = {} } = {}) {
  const values = new Map(Object.entries(storage))
  const wx = {
    getSystemInfoSync: () => ({ platform }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
    getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: key => values.delete(key)
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/config.js'), 'utf8'), { module, wx })
  return { config: module.exports, wx, values }
}

test('模拟器默认连电脑本机，手机未设置地址时立即提示', () => {
  const simulator = connection({ platform: 'devtools' })
  assert.equal(simulator.config.baseUrl, 'http://127.0.0.1:8080/api/v1')
  assert.equal(simulator.config.connectionIssue(), '')
  const mobile = connection()
  assert.match(mobile.config.connectionIssue(), /服务地址/)
  assert.equal(mobile.config.canConfigureDevelopment(), true)
})

test('保存开发地址后现有请求模块立即使用新地址，无需重启或重新编译', async () => {
  const { config, wx } = connection()
  const calls = []
  wx.request = options => { calls.push(options); options.success({ statusCode: 200, data: { code: 0, data: {} } }) }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8'), {
    module, wx, require: name => { assert.equal(name, './config'); return config }
  })
  await assert.rejects(module.exports.get('/app-config'), /服务地址/)
  assert.equal(calls.length, 0)
  assert.equal(config.saveDevelopmentBaseUrl('  http://192.0.2.10:8080/ '), 'http://192.0.2.10:8080/api/v1')
  await module.exports.get('/app-config', null, { auth: false, timeout: 5000 })
  assert.equal(calls[0].url, 'http://192.0.2.10:8080/api/v1/app-config')
  assert.equal(calls[0].timeout, 5000)
  config.saveDevelopmentBaseUrl('https://development.example.test/api/v1')
  await module.exports.get('/app-config', null, { auth: false })
  assert.equal(calls[1].url, 'https://development.example.test/api/v1/app-config')
})

test('手机拒绝本机、占位及畸形地址，正式版禁止覆盖', () => {
  const { config, values } = connection()
  for (const value of ['http://127.0.0.1:8080', 'http://localhost:8080', 'http://[::1]:8080',
    'https://api.example.com/api/v1', 'ftp://example.test', 'http://user:password@example.test',
    'https://example.test/api/v1?token=secret', 'https://example.test/#/api/v1']) {
    assert.throws(() => config.saveDevelopmentBaseUrl(value))
  }
  assert.equal(values.has('apiBaseUrl'), false)
  const release = connection({ version: 'release', storage: { apiBaseUrl: 'https://untrusted.example.test/api/v1' } })
  assert.equal(release.config.canConfigureDevelopment(), false)
  assert.equal(release.config.baseUrl, 'https://api.example.com/api/v1')
  assert.throws(() => release.config.saveDevelopmentBaseUrl('https://example.test'), /正式版/)
  assert.match(release.config.connectionIssue(), /联系管理员/)
})

test('网络超时、域名拒绝与连接失败返回可理解原因，不伪造鉴权失败', async () => {
  const { config, wx, values } = connection({ platform: 'devtools', storage: { accessToken: 'keep-token' } })
  const module = { exports: {} }
  let detail
  wx.request = options => options.fail({ errMsg: detail })
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/request.js'), 'utf8'), {
    module, wx, require: () => config
  })
  for (const [raw, pattern] of [['request:fail timeout', /连接超时/],
    ['request:fail url not in domain list', /域名未允许/], ['request:fail connect ECONNREFUSED', /无法连接后端/]]) {
    detail = raw
    await assert.rejects(module.exports.get('/users/me'), error => error.network && pattern.test(error.message))
  }
  assert.equal(values.get('accessToken'), 'keep-token')
})

test('登录/历史/资料使用有限等待，流式回复和照片分析保留原等待策略', async () => {
  const calls = []
  const record = (url, data, options) => { calls.push({ url, options }); return Promise.resolve({ accessToken: 'token' }) }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/api.js'), 'utf8'), {
    module, wx: { setStorageSync() {} }, require: name => ({
      './meal-analysis-mock': { isEnabled: () => false },
      '../utils/request': { get: record, post: record, setToken() {} },
      '../utils/mappers': { mapUserMe: value => value },
      '../utils/chat-sessions': require('../../utils/chat-sessions'),
      '../utils/food-images': {}, '../utils/sse': { openSse: options => calls.push(options) }
    }[name])
  })
  const api = module.exports
  await api.wechatLogin('code'); await api.phoneLogin('phone', 'sms')
  await api.getOrCreateChatSession(3); await api.fetchChatHistory('9', {})
  await api.fetchMe(); await api.fetchAppConfig(['TEXT'])
  assert.equal(calls.slice(0, 2).every(call => call.options.timeout === 15000), true)
  assert.equal(calls.slice(2).every(call => call.options.timeout === 10000), true)
  await api.analyzeMealPhoto({})
  assert.equal(calls.at(-1).options.timeout, 90000)
  api.streamChatCompletion('9', {}, {})
  assert.equal(calls.at(-1).timeout, undefined)
})
