const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function createFlow(options = {}) {
  let app
  const state = {
    storage: new Map(Object.entries(options.storage || {})),
    route: options.route || 'pages/login/login',
    profile: { disclaimerAgreed: false, disclaimerVersion: '', ...options.profile },
    routes: [], toasts: [], timers: [], measurements: [], profiles: 0, configs: 0, agreements: 0, logins: []
  }
  const token = () => state.storage.get('accessToken') || ''
  const request = { getToken: token, setToken(value) { if (value) state.storage.set('accessToken', value); else state.storage.delete('accessToken') } }
  const storage = {
    getUserInfo: () => state.storage.get('userInfo') || null,
    saveUserInfo: (value) => state.storage.set('userInfo', value),
    login: () => state.storage.set('isLoggedIn', true)
  }
  const display = { applyDisplayToCurrentPage() {}, saveDisplaySettings() {}, getDisplayStyle: () => '' }
  const services = {
    async fetchMe() { state.profiles++; if (options.profileError) throw options.profileError; return { ...state.profile } },
    async fetchAppConfig() { state.configs++; return options.configFetch ? options.configFetch() : { TEXT: { 'text.disclaimer.version': 'v1' } } },
    async agreeDisclaimer(version) {
      state.agreements++
      if (options.agreementError) throw options.agreementError
      state.profile = { ...state.profile, disclaimerAgreed: true, disclaimerVersion: version }
    },
    async wechatLogin(code) { state.logins.push(['wechat', code]); request.setToken('new-token'); return { accessToken: token() } },
    async phoneLogin(phone, code) { state.logins.push(['phone', phone, code]); request.setToken('new-token'); return { accessToken: token() } },
    async sendSmsCode() {}
  }
  const wx = {
    getStorageSync: (key) => state.storage.get(key),
    setStorageSync: (key, value) => state.storage.set(key, value),
    showLoading() {}, hideLoading() {},
    showToast: (value) => state.toasts.push(value),
    login: (value) => value.success({ code: 'wechat-code' }),
    reLaunch(value) { state.routes.push(value.url); state.route = value.url.split('?')[0].slice(1); if (value.complete) value.complete() },
    switchTab(value) { state.routes.push(value.url); state.route = value.url.slice(1) },
    navigateBack() { state.routes.push('back') }
  }
  const dependencies = {
    './utils/i18n': { install() {} },
    './utils/message-notifications': { start(){},stop(){},reset(){} },
    './utils/display': display, './utils/storage': storage, './utils/request': request,
    './services/api': services, './utils/config': { baseUrl: '' },
    './utils/mappers': { fontNameOf: () => '标准', themeIdOf: () => 'green' }
  }
  const config = { connectionIssue: () => options.connectionIssue || '' }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App: (value) => { app = value }, wx,
    getCurrentPages: () => state.route ? [{ route: state.route }] : [],
    require: (name) => { assert.ok(dependencies[name], name); return dependencies[name] }
  })

  function page(name) {
    let definition
    const pageDependencies = {
      '../../utils/display': display, '../../utils/storage': storage, '../../utils/request': request,
      '../../services/api': services, '../../utils/constants': { DISCLAIMER_CONTENT: ['声明正文'] },
      '../../utils/config': config
    }
    vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/${name}.js`), 'utf8'), {
      Page: (value) => { definition = value }, getApp: () => app, wx,
      require: (dependency) => { assert.ok(pageDependencies[dependency], dependency); return pageDependencies[dependency] },
      setTimeout: (callback) => { state.timers.push(callback); return state.timers.length },
      clearInterval() {}, setInterval: () => 1
    })
    return { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
      setData(value, callback) { Object.assign(this.data, value); if (callback) callback() },
      createSelectorQuery() {
        const query = { select() { return query }, boundingClientRect() { return query },
          exec(callback) { state.measurements.push(callback) } }
        return query
      } }
  }
  return { app, state, page, request }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function loggedInDisclaimer(options) {
  const flow = createFlow(options)
  flow.app.globalData.isLoggedIn = true
  flow.request.setToken('current-user')
  return { ...flow, disclaimer: flow.page('disclaimer') }
}

const layout = (viewportHeight, contentBottom, contentHeight = 1200) => [
  { top: 100, bottom: 100 + viewportHeight, height: viewportHeight },
  { top: contentBottom - contentHeight, bottom: contentBottom, height: contentHeight }
]

test('首次滚动到底即解锁，不依赖触底事件，读完不会自动提交同意', async () => {
  const { disclaimer, state } = loggedInDisclaimer()
  await disclaimer.onLoad({ forced: '1' })
  disclaimer.onReady()
  state.measurements.at(-1)(layout(400, 1300))
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: 780, scrollHeight: 1200 } })
  assert.equal(disclaimer.data.canAgree, false)
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: 798.5, scrollHeight: 1200 } })
  assert.equal(disclaimer.data.canAgree, true)
  assert.equal(state.agreements, 0)
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: 0, scrollHeight: 1200 } })
  assert.equal(disclaimer.data.canAgree, true)
})

test('文案不足一屏时渲染后即可同意，零尺寸和非法滚动数据不提前解锁', async () => {
  const { disclaimer, state } = loggedInDisclaimer()
  await disclaimer.onLoad({})
  disclaimer.onReady()
  state.measurements.at(-1)(layout(0, 100, 0))
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: -100, scrollHeight: 100 } })
  state.measurements.at(-1)(layout(400, 1300))
  for (const detail of [{}, { scrollTop: 1000, scrollHeight: 0 }, { scrollTop: NaN, scrollHeight: 1200 }]) {
    disclaimer.onDisclaimerScroll({ detail })
    assert.equal(disclaimer.data.canAgree, false)
  }
  disclaimer.measureReadPosition()
  state.measurements.at(-1)(layout(400, 380, 280))
  assert.equal(disclaimer.data.canAgree, true)
  assert.equal(state.agreements, 0)
})

test('已滑到底后异步文案回填会复核当前位置，不需要再向上向下滑', async () => {
  let resolveConfig
  const { disclaimer, state } = loggedInDisclaimer({ configFetch: () => new Promise(resolve => { resolveConfig = resolve }) })
  const loading = disclaimer.onLoad({ forced: '1' })
  disclaimer.onReady()
  state.measurements.at(-1)(layout(400, 1300))
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: 800, scrollHeight: 1200 } })
  assert.equal(disclaimer.data.canAgree, true)
  resolveConfig({ TEXT: { 'text.disclaimer.version': 'v1' } })
  await loading
  assert.equal(disclaimer.data.canAgree, false)
  state.measurements.at(-1)(layout(400, 500))
  assert.equal(disclaimer.data.canAgree, true)
  assert.equal(state.agreements, 0)
})

test('更新为更长文案时旧布局不解锁，必须读到新内容底部', async () => {
  const { disclaimer, state } = loggedInDisclaimer()
  await disclaimer.onLoad({})
  disclaimer.onReady()
  const oldMeasurement = state.measurements.at(-1)
  await disclaimer.loadDisclaimer()
  oldMeasurement(layout(400, 500))
  assert.equal(disclaimer.data.canAgree, false)
  state.measurements.at(-1)(layout(400, 900, 1600))
  assert.equal(disclaimer.data.canAgree, false)
  disclaimer.onDisclaimerScroll({ detail: { scrollTop: 1200, scrollHeight: 1600 } })
  assert.equal(disclaimer.data.canAgree, true)
})

test('声明隐藏后忽略旧测量与滚动，返回或窗口变化重新测量', async () => {
  const { disclaimer, state } = loggedInDisclaimer()
  await disclaimer.onLoad({})
  disclaimer.onReady()
  const pending = state.measurements.at(-1)
  disclaimer.onHide()
  pending(layout(400, 500))
  disclaimer.onScrollToBottom()
  assert.equal(disclaimer.data.canAgree, false)
  disclaimer.onShow()
  state.measurements.at(-1)(layout(300, 900))
  disclaimer.onResize()
  state.measurements.at(-1)(layout(600, 700))
  assert.equal(disclaimer.data.canAgree, true)
})

test('卸载或切换账号后忽略迟到的声明配置，不更新版本和可同意状态', async () => {
  for (const reason of ['unload', 'account']) {
    let resolveConfig
    const { disclaimer, state, request } = loggedInDisclaimer({ configFetch: () => new Promise(resolve => { resolveConfig = resolve }) })
    const loading = disclaimer.onLoad({})
    if (reason === 'unload') disclaimer.onUnload()
    else request.setToken('another-user')
    resolveConfig({ TEXT: { 'text.disclaimer.version': 'v-new' } })
    await loading
    assert.equal(disclaimer.data.version, '')
    assert.equal(disclaimer.data.canAgree, false)
    assert.equal(state.storage.get('disclaimerCurrentVersion'), undefined)
  }
})

test('服务地址不可用时不发起登录请求，展示具体配置原因', () => {
  const { page, state } = createFlow({ connectionIssue: '未配置地址' })
  const login = page('login'); login.onLoad(); login.onWechatLogin()
  assert.equal(state.logins.length, 0)
  assert.equal(state.toasts[0].title, '未配置地址')
})

test('真机冷启动忽略旧登录缓存，先展示两个登录按钮且不请求资料或声明', () => {
  const { app, state, page, request } = createFlow({ storage: { isLoggedIn: true, accessToken: 'cached-token', userInfo: { nickname: 'old' } } })
  app.onLaunch()
  app.onShow({ path: 'pages/login/login' })
  page('login').onLoad()
  assert.equal(app.globalData.isLoggedIn, false)
  assert.equal(request.getToken(), '')
  assert.equal(state.profiles, 0)
  assert.equal(state.configs, 0)
  assert.equal(state.routes.length, 0)
  const template = fs.readFileSync(path.join(root, 'pages/login/login.wxml'), 'utf8')
  assert.match(template, /微信一键登录/)
  assert.match(template, /手机号登录/)
})

test('未登录从调试路径直达声明时返回登录，不能加载或提交同意', () => {
  const { app, state, page } = createFlow({ route: 'pages/disclaimer/disclaimer' })
  app.onLaunch()
  const disclaimer = page('disclaimer')
  disclaimer.onLoad({ forced: '1' })
  disclaimer.setData({ canAgree: true, version: 'v1' })
  disclaimer.onAgree()
  assert.equal(state.routes[0], '/pages/login/login')
  assert.equal(state.configs, 0)
  assert.equal(state.agreements, 0)
})

test('登录页不会被前台恢复声明检查抢占，缓存标记也不触发页面自动登录', () => {
  const { app, state, page, request } = createFlow()
  app.globalData.isLoggedIn = true
  request.setToken('existing-token')
  app.onShow()
  page('login').onLoad()
  assert.equal(state.profiles, 0)
  assert.equal(state.routes.length, 0)
})

test('点击微信登录后才检查声明，读到底并成功提交后进入记录页', async () => {
  const { app, state, page } = createFlow()
  app.onLaunch()
  const login = page('login')
  login.onLoad()
  login.onWechatLogin()
  await flush()
  assert.equal(state.logins[0][0], 'wechat')
  assert.equal(state.profiles, 1)
  assert.equal(state.routes.at(-1), '/pages/disclaimer/disclaimer?forced=1')
  assert.equal(app.getNavigationGuideToken(), '')
  const disclaimer = page('disclaimer')
  await disclaimer.onLoad({ forced: '1' })
  disclaimer.onAgree()
  assert.equal(state.agreements, 0)
  disclaimer.onScrollToBottom()
  await disclaimer.onAgree()
  assert.equal(state.agreements, 1)
  assert.equal(app.globalData.disclaimerRequired, false)
  assert.equal(app.getNavigationGuideToken(), 'new-token')
  state.timers.at(-1)()
  assert.equal(state.routes.at(-1), '/pages/ai/ai')
  assert.equal(app.completeNavigationGuide('other-token'), false)
  assert.equal(app.getNavigationGuideToken(), 'new-token')
  assert.equal(app.completeNavigationGuide('new-token'), true)
  assert.equal(app.getNavigationGuideToken(), '')
  await app.syncProfile()
  assert.equal(app.getNavigationGuideToken(), '')
})

test('手机号登录且已同意当前版本时直接进入记录页，不重复展示声明', async () => {
  const { app, state, page } = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v1' } })
  app.onLaunch()
  const login = page('login')
  login.onPhoneLogin()
  assert.equal(login.data.phonePanel, true)
  login.setData({ phone: '13800000000', smsCode: '123456' })
  login.onConfirmPhoneLogin()
  await flush()
  assert.equal(state.logins[0][0], 'phone')
  assert.equal(state.routes.at(-1), '/pages/ai/ai')
  assert.equal(state.routes.some((url) => url.includes('disclaimer')), false)
  assert.equal(app.getNavigationGuideToken(), '')
})

test('登录后资料获取失败或401留在登录流程，不再强跳免责声明', async () => {
  for (const error of [new Error('network'), Object.assign(new Error('expired'), { code: 40100 })]) {
    const { app, state, page, request } = createFlow({ profileError: error })
    app.onLaunch()
    page('login').onWechatLogin()
    await flush()
    assert.equal(state.route, 'pages/login/login')
    assert.equal(app.globalData.isLoggedIn, false)
    assert.equal(request.getToken(), '')
    assert.equal(state.routes.some((url) => url.includes('disclaimer')), false)
    assert.equal(state.toasts.length, 1)
  }
})

test('切到后台再回来保留本次有效登录，当前声明已同意时不跳登录或声明', async () => {
  const { app, state, page } = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v1' } })
  app.onLaunch()
  page('login').onWechatLogin()
  await flush()
  const count = state.routes.length
  app.onShow({ path: 'pages/index/index' })
  await flush()
  assert.equal(app.globalData.isLoggedIn, true)
  assert.equal(state.routes.length, count)
})

test('声明提交401返回登录，不标记已同意或继续进入首页', async () => {
  const { app, state, page, request } = createFlow({ route: 'pages/disclaimer/disclaimer', agreementError: Object.assign(new Error('expired'), { code: 40100 }) })
  app.globalData.isLoggedIn = true
  request.setToken('valid-token')
  const disclaimer = page('disclaimer')
  await disclaimer.onLoad({ forced: '1' })
  disclaimer.onScrollToBottom()
  await disclaimer.onAgree()
  assert.equal(state.routes.at(-1), '/pages/login/login')
  assert.equal(app.globalData.isLoggedIn, false)
  assert.equal(state.storage.get('disclaimerAgreed'), undefined)
  assert.equal(state.timers.length, 0)
  assert.equal(app.getNavigationGuideToken(), '')
})

test('老用户确认新版声明不会触发新手引导，重复阅读也不会重新触发', async () => {
  const { app, page, state } = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v0' } })
  app.onLaunch()
  page('login').onWechatLogin()
  await flush()
  const disclaimer = page('disclaimer')
  await disclaimer.onLoad({ forced: '1' })
  disclaimer.onScrollToBottom()
  await disclaimer.onAgree()
  state.timers.at(-1)()
  assert.equal(app.getNavigationGuideToken(), '')
  app.markDisclaimerAgreed('v1')
  assert.equal(app.getNavigationGuideToken(), '')
})

test('同意失败不启动引导，退出或切换账号后旧引导与跳转作废', async () => {
  const failed = createFlow({ agreementError: new Error('network') })
  failed.page('login').onWechatLogin()
  await flush()
  const failedDisclaimer = failed.page('disclaimer')
  await failedDisclaimer.onLoad({ forced: '1' })
  failedDisclaimer.onScrollToBottom()
  await failedDisclaimer.onAgree()
  assert.equal(failed.app.getNavigationGuideToken(), '')
  assert.equal(failed.state.timers.length, 0)

  const { app, page, state, request } = createFlow()
  page('login').onWechatLogin()
  await flush()
  const disclaimer = page('disclaimer')
  await disclaimer.onLoad({ forced: '1' })
  disclaimer.onScrollToBottom()
  await disclaimer.onAgree()
  assert.equal(app.getNavigationGuideToken(), 'new-token')
  request.setToken('other-account-token')
  assert.equal(app.getNavigationGuideToken(), '')
  assert.equal(app.completeNavigationGuide('new-token'), false)
  const routes = state.routes.length
  state.timers.at(-1)()
  assert.equal(state.routes.length, routes)
  app.resetLoginState()
  assert.equal(app.globalData.navigationGuideToken, '')
})
