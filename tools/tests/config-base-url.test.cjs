/**
 * 后端地址解析（utils/config）——2026-10-16 登录事故的回归测试。
 *
 * 事故现象：小程序点了微信登录**一个请求都没发**，后端没有任何日志。
 * 根因链：基础库 3.17+ 弃用 wx.getSystemInfoSync → 环境识别失败（isDevtools=false）
 * → 回落到占位生产域名 https://api.example.com/api/v1 → connectionIssue() 判定"服务地址尚未配置"
 * → 登录动作在发请求之前就被拦下。
 *
 * 因此这里钉住四件事：
 *   1. 只提供新 API（wx.getDeviceInfo）时也必须认出开发者工具——这正是事故的触发条件；
 *   2. 认不出环境时不许静默回落到占位生产域名（那个域名永远不可能通）；
 *   3. storage 里的覆盖地址要宽容解析（可只填 host:port），且无效时要有告警而不是静默忽略；
 *   4. 报错信息里必须带"实际打到了哪个地址"，否则同类问题无法自查。
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const CONFIG_PATH = path.join(__dirname, '..', '..', 'utils', 'config.js')

/**
 * 每个用例都用干净的模块缓存 + 自定义 wx 桩。
 * <p>
 * ⚠️ 告警收集必须**覆盖整个用例体**，不能只在 require 期间挂 console.warn：
 * 告警是在调用 resolveBaseUrl()/connectionIssue() 时才发出的（第一版测试就是这么写错的，
 * 结果是"明明有告警却断言没有"）。
 */
function withConfig(wxStub, fn) {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  global.wx = wxStub
  delete require.cache[require.resolve(CONFIG_PATH)]
  try {
    const config = require(CONFIG_PATH)
    return fn(config, warnings)
  } finally {
    console.warn = originalWarn
  }
}

/** 不关心告警时的简写。 */
function loadConfig(wxStub) {
  return withConfig(wxStub, (config, warnings) => ({ config, warnings }))
}

function wxStub(options) {
  const opts = options || {}
  return {
    // 只有新 API，模拟"基础库已弃用旧 API"的环境（事故现场）
    ...(opts.withDeviceInfo !== false
      ? { getDeviceInfo: () => ({ platform: opts.platform }) }
      : {}),
    ...(opts.withSystemInfoSync ? { getSystemInfoSync: () => ({ platform: opts.systemPlatform }) } : {}),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: opts.envVersion || 'develop' } }),
    getStorageSync: (key) => (key === 'apiBaseUrl' ? opts.apiBaseUrl || '' : ''),
    setStorageSync: () => {}
  }
}

test('只提供 wx.getDeviceInfo 时也能认出开发者工具（事故发生点）', () => {
  const { config, warnings } = loadConfig(wxStub({ platform: 'devtools' }))

  assert.strictEqual(config.devicePlatform(), 'devtools')
  assert.deepStrictEqual(config.resolveBaseUrl(), {
    url: 'http://127.0.0.1:8080/api/v1',
    source: 'devtools-default'
  })
  assert.strictEqual(config.connectionIssue(), '', '开发者工具里不该报"服务未就绪"')
  assert.deepStrictEqual(warnings, [], '能识别环境时不该有告警')
})

test('只有旧 API 时仍能识别（兜底不能删）', () => {
  const { config } = loadConfig(wxStub({ withDeviceInfo: false, withSystemInfoSync: true, systemPlatform: 'devtools' }))

  assert.strictEqual(config.resolveBaseUrl().source, 'devtools-default')
})

test('两个 API 都拿不到时不回落到占位生产域名，而是给本机地址并告警', () => {
  withConfig(wxStub({ withDeviceInfo: false, envVersion: 'develop' }), (config, warnings) => {
    assert.strictEqual(config.devicePlatform(), '')
    assert.strictEqual(config.resolveBaseUrl().source, 'dev-fallback')
    assert.strictEqual(config.resolveBaseUrl().url, 'http://127.0.0.1:8080/api/v1')
    assert.ok(warnings.some((w) => w.includes('未能识别运行环境')), '必须留下可查的告警：' + warnings.join(' | '))
  })
})

test('正式版（release）仍回落到生产地址并给出明确提示', () => {
  const { config } = loadConfig(wxStub({ platform: 'ios', envVersion: 'release' }))

  assert.strictEqual(config.resolveBaseUrl().source, 'production')
  assert.strictEqual(config.connectionIssue(), '服务地址尚未配置，请联系管理员')
})

test('真机上用本机地址时给出可执行的修复指引', () => {
  const { config } = loadConfig(wxStub({ platform: 'android', envVersion: 'develop' }))
  const issue = config.connectionIssue()

  assert.ok(issue.includes('局域网'), issue)
  assert.ok(issue.includes('apiBaseUrl'), '提示里要写清怎么改：' + issue)
})

test('storage 覆盖地址宽容解析：只填 host:port 也能用', () => {
  const { config } = loadConfig(wxStub({ platform: 'devtools', apiBaseUrl: '192.168.1.5:8080' }))

  assert.deepStrictEqual(config.resolveBaseUrl(), {
    url: 'http://192.168.1.5:8080/api/v1',
    source: 'storage:apiBaseUrl'
  })
})

test('覆盖地址带结尾斜杠、已含 /api/v1 时都能规整', () => {
  assert.strictEqual(
    loadConfig(wxStub({ platform: 'devtools', apiBaseUrl: 'http://192.168.1.5:8080/api/v1/' })).config.resolveBaseUrl().url,
    'http://192.168.1.5:8080/api/v1'
  )
  assert.strictEqual(
    loadConfig(wxStub({ platform: 'devtools', apiBaseUrl: 'https://demo.example.cn/api/v1' })).config.resolveBaseUrl().url,
    'https://demo.example.cn/api/v1'
  )
})

test('无效的覆盖地址要告警而不是静默忽略', () => {
  withConfig(wxStub({ platform: 'devtools', apiBaseUrl: 'http:///坏地址' }), (config, warnings) => {
    assert.strictEqual(config.resolveBaseUrl().source, 'devtools-default', '无效覆盖应被忽略并回落到开发默认')
    assert.ok(warnings.some((w) => w.includes('已忽略无效的 apiBaseUrl')), warnings.join(' | '))
  })
})

test('历史占位域名不算有效覆盖（避免它一直遮住真实地址）', () => {
  const { config } = loadConfig(wxStub({ platform: 'devtools', apiBaseUrl: 'https://api.example.com/api/v1' }))

  assert.strictEqual(config.resolveBaseUrl().source, 'devtools-default')
})

test('正式版忽略 storage 覆盖（不能靠改缓存把正式版指到内网）', () => {
  const { config } = loadConfig(wxStub({ platform: 'ios', envVersion: 'release', apiBaseUrl: 'http://192.168.1.5:8080' }))

  assert.strictEqual(config.resolveBaseUrl().source, 'production')
})

test('请求失败信息里带上实际地址（本次事故最难查的一环）', () => {
  const requestPath = path.join(__dirname, '..', '..', 'utils', 'request.js')
  global.wx = Object.assign(wxStub({ platform: 'devtools' }), {
    request: (options) => options.fail({ errMsg: 'request:fail' })
  })
  delete require.cache[require.resolve(CONFIG_PATH)]
  delete require.cache[require.resolve(requestPath)]
  const request = require(requestPath)

  return request.get('/configs/public', {}, { auth: false }).then(
    () => assert.fail('应当失败'),
    (err) => {
      assert.ok(err.network, '应标记为网络错误')
      assert.ok(err.message.includes('http://127.0.0.1:8080/api/v1'), '错误信息里必须带地址：' + err.message)
    }
  )
})

test('开发者工具代理不可用时给出"改代理设置"的明确指引（2026-10-16 事故）', async () => {
  const requestPath = path.join(__dirname, '..', '..', 'utils', 'request.js')
  global.wx = Object.assign(wxStub({ platform: 'devtools' }), {
    request: (options) => options.fail({
      errMsg: 'request:fail tunneling socket could not be established, cause=connect ECONNREFUSED 127.0.0.1:7890'
    })
  })
  delete require.cache[require.resolve(CONFIG_PATH)]
  delete require.cache[require.resolve(requestPath)]
  const request = require(requestPath)

  await assert.rejects(request.get('/users/me'), (err) => {
    assert.ok(err.proxy, '应被识别为代理问题')
    assert.ok(err.message.includes('代理'), err.message)
    assert.ok(err.message.includes('不使用任何代理'), '要直接给出该改的设置：' + err.message)
    return true
  })
})

test('wx.login 因代理失败时也要提示代理设置，而不是含糊的"wx.login 失败"', () => {
  const login = require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'pages', 'login', 'login.js'), 'utf8')

  assert.ok(login.includes('tunneling socket'), '登录页要识别代理类错误')
  assert.ok(login.includes('不使用任何代理'), '登录页要给出可执行的修复指引')
})