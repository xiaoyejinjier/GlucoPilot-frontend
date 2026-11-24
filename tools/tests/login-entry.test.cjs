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
    routes: [], toasts: [], timers: [], measurements: [], profiles: 0, configs: 0, agreements: 0, logins: [], modals: [], sms:[], emails:[], invalidated: []
  }
  // 既有登录流程测试默认从已同意状态开始；首次使用用例显式设置agreementChecked:false。
  if(options.agreementChecked!==false&&!state.storage.has('loginAgreementAcceptance'))
    state.storage.set('loginAgreementAcceptance',{version:'v1',accepted:true})
  const token = () => state.storage.get('accessToken') || ''
  const request = { getToken: token, setToken(value) { if (value) state.storage.set('accessToken', value); else state.storage.delete('accessToken') } }
  const storage = {
    getUserInfo: () => state.storage.get('userInfo') || null,
    saveUserInfo: (value) => state.storage.set('userInfo', value),
    login: () => state.storage.set('isLoggedIn', true),
    clearAccountCache() {
      for (const key of ['accessToken', 'userInfo', 'glucoseRecords', 'isLoggedIn']) state.storage.delete(key)
    }
  }
  const display = { applyDisplayToCurrentPage() {}, saveDisplaySettings() {}, getDisplayStyle: () => '' }
  const services = {
    async fetchMe() { state.profiles++; if (options.profileError) throw options.profileError; return options.profileFetch ? options.profileFetch() : { ...state.profile } },
    async fetchAppConfig() { state.configs++; return options.configFetch ? options.configFetch() : { TEXT: { 'text.disclaimer.version': 'v1' } } },
    async agreeDisclaimer(version) {
      state.agreements++
      if (options.agreementError) throw options.agreementError
      state.profile = { ...state.profile, disclaimerAgreed: true, disclaimerVersion: version }
    },
    async wechatLogin(code) { state.logins.push(['wechat', code]); request.setToken('new-token'); return { accessToken: token() } },
    async phoneLogin(phone, code) { state.logins.push(['phone', phone, code]); if(options.phoneLoginError)throw options.phoneLoginError; request.setToken('new-token'); return { accessToken: token() } },
    async emailLogin(email, code) { state.logins.push(['email', email, code]); if(options.emailLoginError)throw options.emailLoginError; if(options.emailLoginPromise)await options.emailLoginPromise; request.setToken('new-token'); return { accessToken: token() } },
    async sendSmsCode(...args) { state.sms.push(args) },
    async sendEmailCode(...args) { state.emails.push(args) }
  }
  const wx = {
    getWindowInfo: () => options.windowInfo || { statusBarHeight: 0 },
    getMenuButtonBoundingClientRect: () => options.capsule || { bottom: 0 },
    getStorageSync: (key) => { if(options.preferenceStorageError&&['lastLoginEmail','loginAgreementAcceptance'].includes(key))throw Error('Storage unavailable'); return state.storage.get(key) },
    setStorageSync: (key, value) => { if(options.preferenceStorageError&&['lastLoginEmail','loginAgreementAcceptance'].includes(key))throw Error('Storage unavailable'); return state.storage.set(key, value) },
    showLoading() {}, hideLoading() {},
    showToast: (value) => state.toasts.push(value),
    showModal: (value) => state.modals.push(value),
    login: (value) => value.success({ code: 'wechat-code' }),
    reLaunch(value) { state.routes.push(value.url); state.route = value.url.split('?')[0].slice(1); if (value.complete) value.complete() },
    switchTab(value) { state.routes.push(value.url); state.route = value.url.slice(1) },
    navigateTo(value) { state.routes.push(value.url) },
    navigateBack() { state.routes.push('back') }
  }
  let accountVault = { remember() {}, invalidateToken(token) { if(token)state.invalidated.push(token) }, list: () => [] }
  const vaultConfig = { baseUrl: 'https://accounts.example.test/api/v1' }
  if (options.realVault) {
    const module = { exports:{} }
    vm.runInNewContext(fs.readFileSync(path.join(root,'utils/account-vault.js'),'utf8'), {module,wx,require:()=>vaultConfig})
    accountVault = module.exports
  }
  const dependencies = {
    './utils/account-vault': accountVault,
    './utils/device-cloud-sync': { tryAutoCloudPull: async () => null },
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
      '../../utils/account-vault': options.realVault ? accountVault : { list: () => options.savedAccounts || [] },
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
    const data = JSON.parse(JSON.stringify(definition.data))
    // Existing login-flow cases start after the user has checked the agreement.
    if (name === 'login' && options.agreementChecked !== false) data.agreementChecked = true
    return { ...definition, data,
      setData(value, callback) { Object.assign(this.data, value); if (callback) callback() },
      createSelectorQuery() {
        const query = { select() { return query }, boundingClientRect() { return query },
          exec(callback) { state.measurements.push(callback) } }
        return query
      } }
  }
  return { app, state, page, request, vault:accountVault, vaultConfig }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

for (const action of ['onWechatLogin','onPhoneLogin','onEmailLogin']) test('默认未勾选，弹框同意后自动勾选，再次点击登录才继续：'+action, async()=>{
 const flow=createFlow({agreementChecked:false}),page=flow.page('login')
 page[action]();page[action]()
 assert.equal(flow.state.modals.length,1);assert.equal(flow.state.logins.length,0)
 assert.equal(page.data.phonePanel,false);assert.equal(page.data.emailPanel,false)
 assert.equal(page.data.agreementChecked,false)
 flow.state.modals[0].success({confirm:true});await flush()
 assert.equal(page.data.agreementChecked,true)
 assert.equal(flow.state.logins.length,0)
 assert.equal(page.data.phonePanel,false);assert.equal(page.data.emailPanel,false)
 assert.equal(flow.state.modals[0].showCancel,true)
 assert.equal(flow.state.modals[0].confirmText,'同意')
 assert.equal(flow.state.modals[0].cancelText,'拒绝')
 page[action]();await flush()
 assert.equal(page.data.agreementChecked,true)
 if(action==='onWechatLogin')assert.equal(flow.state.logins.length,1)
 if(action==='onPhoneLogin')assert.equal(page.data.phonePanel,true)
 if(action==='onEmailLogin')assert.equal(page.data.emailPanel,true)
 assert.equal(flow.state.sms.length,0)
})

test('拒绝只关闭提示不勾选不登录；手动勾选可继续，离开后旧同意回调作废', async()=>{
 const flow=createFlow({agreementChecked:false}),page=flow.page('login')
 page.onWechatLogin();flow.state.modals[0].success({confirm:false});await flush()
 assert.equal(page.data.agreementChecked,false);assert.equal(flow.state.logins.length,0)
 page.onAgreementChange({detail:{value:['agreed']}});page.onPhoneLogin()
 assert.equal(page.data.phonePanel,true);assert.equal(flow.state.modals.length,1)
 page.onAgreementChange({detail:{value:[]}});page.onWechatLogin();page.onHide()
 flow.state.modals[1].success({confirm:true});await flush()
 assert.equal(page.data.agreementChecked,false);assert.equal(flow.state.logins.length,0)
})

test('自动填充手机号也不能绕过协议，未同意不发送验证码或提交登录',()=>{
 for(const action of ['onSendSms','onSendEmailCode','onConfirmPhoneLogin','onConfirmEmailLogin']){
  const flow=createFlow({agreementChecked:false}),page=flow.page('login')
  flow.app.globalData.pendingLoginPhone='13900000002';page.onShow()
  page[action]();assert.equal(flow.state.modals.length,1)
  assert.equal(flow.state.sms.length,0);assert.equal(flow.state.logins.length,0)
 }
})

test('保存账号入口仅在切换流程展示，普通退出和冷启动隐藏',()=>{
 const flow=createFlow({savedAccounts:[{id:'u1'}]}),page=flow.page('login')
 page.onShow();assert.equal(page.data.hasSavedAccounts,false)
 page.onSavedAccounts();assert.equal(flow.state.routes.length,0)
 flow.app.globalData.accountSwitchFlow=true;page.onShow()
 assert.equal(page.data.hasSavedAccounts,true)
 page.onSavedAccounts();assert.equal(flow.state.routes.at(-1),'/pages/account-switch/account-switch')
 flow.app.resetLoginState();page.onShow();assert.equal(page.data.hasSavedAccounts,false)
 flow.app.globalData.accountSwitchFlow=true;flow.app.onLaunch();page.onShow()
 assert.equal(page.data.hasSavedAccounts,false)
})

test('冷启动保留可切换会话，明确退出才使当前保存会话失效，迟到过期不影响新账号', () => {
 const flow=createFlow({storage:{accessToken:'saved-token'}})
 flow.app.onLaunch();assert.equal(flow.state.invalidated.length,0)
 flow.request.setToken('current-token');flow.app.resetLoginState()
 assert.deepEqual(flow.state.invalidated,['current-token'])
 flow.request.setToken('new-token')
 assert.equal(flow.app.handleSessionExpired('old-token'),false)
 assert.equal(flow.request.getToken(),'new-token')
 flow.request.setToken('');flow.app.handleSessionExpired('new-token')
 assert.deepEqual(flow.state.invalidated,['current-token','new-token'])
})

test('切换失效账号回到登录页时填入对应手机号，不自动发送验证码', () => {
 const flow=createFlow(),page=flow.page('login')
 flow.app.globalData.pendingLoginPhone='13900000002';page.onShow()
 assert.equal(page.data.phonePanel,true);assert.equal(page.data.phone,'13900000002')
 assert.equal(page.data.smsCode,'');assert.equal(flow.state.sms.length,0)
 assert.equal(flow.app.globalData.pendingLoginPhone,'')
})

test('成功手机号登录后记住号码，重新打开默认填入且仅主动点击才发送验证码',async()=>{
 const flow=createFlow(),first=flow.page('login')
 flow.app.goAfterLogin=()=>{}
 first.onPhoneLogin();assert.equal(first.data.phone,'');assert.equal(first.data.lastLoginPhone,'')
 first.onPhoneInput({detail:{value:'13800000001'}});first.onSmsInput({detail:{value:'123456'}})
 first.onConfirmPhoneLogin();await flush()
 assert.equal(flow.state.storage.get('lastLoginPhone'),'13800000001');assert.equal(first.data.smsCode,'')
 const next=flow.page('login');next.onLoad();next.onPhoneLogin()
 assert.equal(next.data.phone,'13800000001');assert.equal(next.data.usingLastPhone,true)
 assert.equal(flow.state.sms.length,0);assert.equal(next.data.smsCode,'')
 next.onSendSms();await flush();assert.deepEqual(flow.state.sms[0],['13800000001','login'])
})

test('默认号码可清空改填或一键恢复，切换号码会清除验证码且不覆盖成功登录历史',()=>{
 const flow=createFlow({storage:{lastLoginPhone:'13800000001'}}),page=flow.page('login')
 page.onPhoneLogin();page.onSmsInput({detail:{value:'123456'}});page.onSwitchPhone()
 assert.equal(page.data.phone,'');assert.equal(page.data.smsCode,'');assert.equal(page.data.phoneFocus,true)
 page.onPhoneInput({detail:{value:'13900000002'}});page.onSmsInput({detail:{value:'654321'}})
 page.onPhoneInput({detail:{value:'13900000003'}});assert.equal(page.data.smsCode,'')
 page.onSwitchPhone();assert.equal(page.data.phone,'13800000001');assert.equal(page.data.usingLastPhone,true)
 assert.equal(flow.state.storage.get('lastLoginPhone'),'13800000001');assert.equal(flow.state.sms.length,0)
})

test('首次协议不勾选，主动同意后下次登录默认勾选，退出及冷启动保留本机选择',async()=>{
 const flow=createFlow({agreementChecked:false}),page=flow.page('login')
 page.onLoad();page.onShow();assert.equal(page.data.agreementChecked,false)
 page.onEmailLogin();flow.state.modals.at(-1).success({confirm:true})
 assert.equal(flow.state.storage.get('loginAgreementAcceptance').accepted,true)
 flow.app.resetLoginState();flow.app.onLaunch()
 const next=flow.page('login');next.onLoad();next.onShow()
 assert.equal(next.data.agreementChecked,true)
 next.onEmailLogin();assert.equal(next.data.emailPanel,true);assert.equal(flow.state.modals.length,1)
 assert.equal(flow.state.emails.length,0)
 // 入口默认勾选不替代后端按当前账号和声明版本要求的正式确认。
 flow.app.globalData.isLoggedIn=true;flow.request.setToken('new-token')
 await flow.app.goAfterLogin();await flush()
 assert.ok(flow.state.routes.includes('/pages/disclaimer/disclaimer?forced=1'))
})

test('手动取消勾选会记住取消，拒绝不改为同意；旧版本或损坏记录也不默认同意',()=>{
 const flow=createFlow({agreementChecked:false}),page=flow.page('login')
 page.onLoad();page.onAgreementChange({detail:{value:['agreed']}})
 const next=flow.page('login');next.onLoad();assert.equal(next.data.agreementChecked,true)
 next.onAgreementChange({detail:{value:[]}})
 const again=flow.page('login');again.onLoad();assert.equal(again.data.agreementChecked,false)
 again.onWechatLogin();flow.state.modals.at(-1).success({confirm:false})
 assert.equal(flow.state.storage.get('loginAgreementAcceptance').accepted,false)
 for(const saved of [true,'true',{version:'old',accepted:true},{version:'v1',accepted:'true'}]){
  const invalid=createFlow({agreementChecked:false,storage:{loginAgreementAcceptance:saved}}).page('login')
  invalid.onLoad();assert.equal(invalid.data.agreementChecked,false)
 }
})

test('邮箱登录成功才记住邮箱，重进回填并支持换邮箱及恢复，不自动发送验证码',async()=>{
 const flow=createFlow(),first=flow.page('login');flow.app.goAfterLogin=()=>{}
 first.onLoad();first.onEmailLogin();first.onEmailInput({detail:{value:'last@example.test'}})
 first.onEmailCodeInput({detail:{value:'123456'}});first.onConfirmEmailLogin();await flush()
 assert.equal(flow.state.storage.get('lastLoginEmail'),'last@example.test');assert.equal(first.data.emailCode,'')
 const next=flow.page('login');next.onLoad();next.onShow();next.onEmailLogin()
 assert.equal(next.data.email,'last@example.test');assert.equal(next.data.usingLastEmail,true)
 assert.equal(flow.state.emails.length,0)
 next.onEmailCodeInput({detail:{value:'123456'}});next.onSwitchEmail()
 assert.equal(next.data.email,'');assert.equal(next.data.emailCode,'');assert.equal(next.data.emailFocus,true)
 next.onEmailInput({detail:{value:'new@example.test'}});next.onEmailCodeInput({detail:{value:'654321'}})
 next.onEmailInput({detail:{value:'another@example.test'}});assert.equal(next.data.emailCode,'')
 next.onSwitchEmail();assert.equal(next.data.email,'last@example.test')
 next.onSendEmailCode();await flush();assert.deepEqual(flow.state.emails,[['last@example.test','login']])
})

test('邮箱失败不覆盖成功历史，旧资料完整邮箱可回填，脱敏或损坏记录不用于发码',async()=>{
 const flow=createFlow({storage:{lastLoginEmail:'last@example.test'},emailLoginError:Error('验证码错误')})
 const page=flow.page('login');page.onEmailLogin();page.onEmailInput({detail:{value:'wrong@example.test'}})
 page.onEmailCodeInput({detail:{value:'000000'}});page.onConfirmEmailLogin();await flush()
 assert.equal(flow.state.storage.get('lastLoginEmail'),'last@example.test')
 const prior=createFlow({storage:{userInfo:{email:'prior@example.test'}}}).page('login')
 prior.onEmailLogin();assert.equal(prior.data.email,'prior@example.test')
 for(const saved of ['u***@example.test','not-email',{},'a'.repeat(130)+'@example.test']){
  const invalid=createFlow({storage:{lastLoginEmail:saved,userInfo:{email:'u***@example.test'}}}).page('login')
  invalid.onEmailLogin();assert.equal(invalid.data.email,'');assert.equal(invalid.data.lastLoginEmail,'')
 }
})

test('本机偏好存储异常不影响本次同意和手动邮箱登录，离开后迟到登录不修改历史邮箱',async()=>{
 const flow=createFlow({agreementChecked:false,preferenceStorageError:true}),page=flow.page('login')
 flow.app.goAfterLogin=()=>{}
 page.onLoad();assert.equal(page.data.agreementChecked,false)
 page.onAgreementChange({detail:{value:['agreed']}});page.onEmailLogin()
 page.onEmailInput({detail:{value:'manual@example.test'}});page.onEmailCodeInput({detail:{value:'123456'}})
 page.onConfirmEmailLogin();await flush();assert.equal(flow.state.logins.length,1)
 let release;const late=createFlow({storage:{lastLoginEmail:'last@example.test'},emailLoginPromise:new Promise(r=>release=r)})
 const hidden=late.page('login');hidden.onShow();hidden.onEmailLogin();hidden.onEmailInput({detail:{value:'late@example.test'}})
 hidden.onEmailCodeInput({detail:{value:'123456'}});hidden.onConfirmEmailLogin();hidden.onHide();release();await flush()
 assert.equal(late.state.storage.get('lastLoginEmail'),'last@example.test')
})

test('错误验证码登录失败不覆盖历史号码，已有资料可兼容回填但不使用脱敏或损坏号码',async()=>{
 const failed=createFlow({storage:{lastLoginPhone:'13800000001'},phoneLoginError:new Error('验证码错误')})
 const page=failed.page('login');page.onPhoneLogin();page.onPhoneInput({detail:{value:'13900000002'}})
 page.onSmsInput({detail:{value:'000000'}});page.onConfirmPhoneLogin();await flush()
 assert.equal(failed.state.storage.get('lastLoginPhone'),'13800000001');assert.equal(failed.app.globalData.isLoggedIn,false)
 const prior=createFlow({storage:{userInfo:{phone:'13700000003'}}}).page('login');prior.onPhoneLogin()
 assert.equal(prior.data.phone,'13700000003');assert.equal(prior.data.usingLastPhone,true)
 for(const saved of ['138****0001',{phone:'13800000001'},'not-a-phone']){
  const invalid=createFlow({storage:{lastLoginPhone:saved,userInfo:{phone:'138****0001'}}}).page('login')
  invalid.onPhoneLogin();assert.equal(invalid.data.phone,'');assert.equal(invalid.data.usingLastPhone,false)
 }
})

test('全局会话失效只提示并跳转一次，清理账号缓存并保留服务器地址', () => {
  const { app, state } = createFlow({ route: 'pages/messages/messages', storage: {
    accessToken: 'old-token', userInfo: { id: '1' }, glucoseRecords: { day: {} }, apiBaseUrl: 'https://api.example.test/api/v1'
  } })
  app.globalData.isLoggedIn = true
  assert.equal(app.handleSessionExpired('old-token', '账号已在其他终端登录，请重新登录'), true)
  assert.equal(state.storage.has('accessToken'), false)
  assert.equal(state.storage.has('userInfo'), false)
  assert.equal(app.globalData.isLoggedIn, false)
  assert.equal(state.storage.get('apiBaseUrl'), 'https://api.example.test/api/v1')
  app.handleSessionExpired('old-token', '重复响应')
  assert.deepEqual(state.routes, ['/pages/login/login'])
  assert.equal(state.toasts.length, 1)
  state.storage.set('accessToken', 'new-token')
  app.globalData.isLoggedIn = true
  assert.equal(app.handleSessionExpired('old-token', '迟到响应'), false)
  assert.equal(state.storage.get('accessToken'), 'new-token')
  assert.equal(app.globalData.isLoggedIn, true)
})

test('旧资料请求未结束时重新登录使用新请求，迟到401不退出新账号', async () => {
  let rejectOld, resolveNew, count = 0
  const oldProfile = new Promise((_resolve, reject) => { rejectOld = reject })
  const newProfile = new Promise(resolve => { resolveNew = resolve })
  const flow = createFlow({ route: 'pages/ai/ai', storage: { accessToken: 'old-token' },
    profileFetch: () => ++count === 1 ? oldProfile : newProfile })
  flow.app.globalData.isLoggedIn = true
  const oldFlow = flow.app.enforceDisclaimer()
  flow.app.handleSessionExpired('old-token', '账号已在其他终端登录，请重新登录')
  flow.state.storage.set('accessToken', 'new-token')
  flow.app.globalData.isLoggedIn = true
  const newFlow = flow.app.goAfterLogin()
  assert.equal(flow.state.profiles, 2)
  resolveNew({ disclaimerAgreed: true, disclaimerVersion: 'v1', accountStatus: 1 })
  await newFlow
  rejectOld(Object.assign(new Error('old session'), { code: 40100 }))
  await oldFlow
  assert.equal(flow.state.storage.get('accessToken'), 'new-token')
  assert.equal(flow.app.globalData.isLoggedIn, true)
  assert.equal(flow.state.routes.at(-1), '/pages/ai/ai')
  assert.equal(flow.state.toasts.length, 1)
})

test('登录布局避开真机胶囊，返回或窗口改变后重读顶部边界',()=>{
  const options={windowInfo:{statusBarHeight:44},capsule:{bottom:76}},flow=createFlow(options),login=flow.page('login')
  login.onLoad();assert.equal(login.data.loginLayoutStyle,'--login-header-space:88px')
  options.capsule.bottom=88;login.onResize();assert.equal(login.data.loginLayoutStyle,'--login-header-space:100px')
  options.capsule.bottom=80;login.onShow();assert.equal(login.data.loginLayoutStyle,'--login-header-space:92px')
  assert.equal(flow.state.logins.length,0);assert.equal(flow.state.routes.length,0)
})
test('旧客户端胶囊尺寸为空时仍预留状态栏和导航间距',()=>{
  const flow=createFlow({windowInfo:{statusBarHeight:24},capsule:{bottom:0}}),login=flow.page('login')
  login.onLoad();assert.equal(login.data.loginLayoutStyle,'--login-header-space:80px')
})

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

/** 冷静期内登录：服务端已恢复并带回 recoveredFromCancellation。 */
function recoveredFlow(profile = {}) {
  const flow = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v1', accountStatus: 1, ...profile } })
  flow.app.globalData.isLoggedIn = true
  flow.request.setToken('current-user')
  flow.app.globalData.recoveredFromCancellation = true
  return flow
}

test('登录即恢复：弹一次告知框，点确定后进入主页', async () => {
  const { app, state } = recoveredFlow()
  const pending = app.goAfterLogin()
  await flush()
  assert.equal(state.modals.length, 1)
  const modal = state.modals[0]
  assert.equal(modal.title, '账号已恢复')
  assert.match(modal.content, /本次登录已自动终止注销申请，账号已恢复正常/)
  assert.match(modal.content, /本次恢复 24 小时后重新提交/)
  assert.match(modal.content, /重新提交后 7 天内请勿登录/)
  assert.equal(modal.confirmText, '我知道了，恢复账号')
  // 单按钮纯告知：关掉弹窗不影响恢复结果，也不阻断后续路由
  assert.equal(modal.showCancel, false)
  assert.equal(state.routes.length, 0)
  modal.complete({ confirm: true })
  await pending
  assert.equal(state.routes.at(-1), '/pages/ai/ai')
})

test('登录即恢复：直接关闭弹窗同样恢复生效并继续进入主页', async () => {
  const { app, state } = recoveredFlow()
  const pending = app.goAfterLogin()
  await flush()
  state.modals[0].complete({ confirm: false, cancel: true })
  await pending
  assert.equal(state.routes.at(-1), '/pages/ai/ai')
  assert.equal(app.globalData.isLoggedIn, true)
})

test('登录即恢复：提示只弹一次，同一次登录后续路由不再重复', async () => {
  const { app, state } = recoveredFlow()
  const first = app.goAfterLogin()
  await flush()
  state.modals[0].complete({ confirm: true })
  await first
  assert.equal(state.modals.length, 1)
  // 标记已被消费：再次进入登录后流程不再弹恢复提示
  await app.goAfterLogin()
  assert.equal(state.modals.length, 1)
  assert.equal(state.routes.at(-1), '/pages/ai/ai')
})

test('未触发恢复时不弹恢复提示，直接进入主页', async () => {
  const flow = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v1', accountStatus: 1 } })
  flow.app.globalData.isLoggedIn = true
  flow.request.setToken('current-user')
  flow.app.globalData.recoveredFromCancellation = false
  await flow.app.goAfterLogin()
  assert.equal(flow.state.modals.length, 0)
  assert.equal(flow.state.routes.at(-1), '/pages/ai/ai')
})

test('恢复后仍为禁用账号：先告知已恢复，再进入封禁提示页', async () => {
  const { app, state } = recoveredFlow({ accountStatus: 0 })
  const pending = app.goAfterLogin()
  await flush()
  assert.equal(state.modals.length, 1)
  assert.equal(state.modals[0].title, '账号已恢复')
  state.modals[0].complete({ confirm: true })
  await pending
  // 封禁账号不可自助注销：不再弹原生选项，直接进入封禁提示页
  assert.equal(state.modals.length, 1)
  assert.equal(state.routes.at(-1), '/pages/account-disabled/account-disabled')
})

test('封禁账号直接登录进入封禁提示页，不再弹原生注销选项', async () => {
  const flow = createFlow({ profile: { disclaimerAgreed: true, disclaimerVersion: 'v1', accountStatus: 0 } })
  flow.app.globalData.isLoggedIn = true
  flow.request.setToken('current-user')
  await flow.app.goAfterLogin()
  assert.equal(flow.state.modals.length, 0)
  assert.equal(flow.state.routes.at(-1), '/pages/account-disabled/account-disabled')
})


test('退出后普通手机号登录及资料刷新不会把临时使用者加入切换列表',async()=>{
 const h=createFlow({realVault:true,profile:{communityKey:'u3',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}})
 h.app.onLaunch();const page=h.page('login');page.onShow()
 page.setData({phone:'13800000003',smsCode:'123456'});page.onConfirmPhoneLogin();await flush()
 assert.equal(h.request.getToken(),'new-token');assert.equal(h.app.globalData.isLoggedIn,true)
 assert.equal(h.vault.list().length,0)
 await h.app.syncProfile();assert.equal(h.vault.list().length,0)
 h.app.exitLoginQuietly();const next=h.page('login');next.onShow()
 next.onWechatLogin();await flush();assert.equal(h.vault.list().length,0)
})

test('切换添加的意图只在成功验证资料后保存，使用一次且退出清除后续意图',async()=>{
 const h=createFlow({realVault:true,profile:{communityKey:'u2',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}})
 h.app.globalData.accountSwitchFlow=true
 h.app.globalData.accountSaveIntent={source:'ACCOUNT_SWITCH',scope:h.vault.scope(),kind:'ADD',expectedId:''}
 const page=h.page('login');page.onShow();page.onWechatLogin();await flush()
 assert.equal(h.vault.list().length,1);assert.equal(h.vault.session('u2').token,'new-token')
 assert.equal(h.app.globalData.accountSaveIntent,null);assert.equal(h.app.globalData.accountSwitchFlow,false)
 h.app.exitLoginQuietly();assert.equal(h.vault.session('u2').token,'');assert.equal(h.app.globalData.accountSaveIntent,null)
 h.state.profile={...h.state.profile,communityKey:'u3'}
 const guest=h.page('login');guest.onShow();guest.onWechatLogin();await flush()
 assert.equal(h.vault.list().length,1);assert.equal(h.vault.session('u3'),null)
})

test('列表重新登录只恢复原保存身份，错误身份或服务器变化不保存',async()=>{
 for(const reason of ['match','identity','server']){
  const h=createFlow({realVault:true,profile:{communityKey:reason==='identity'?'u3':'u2',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}})
  h.vault.remember({communityKey:'u2'},'old',undefined,{explicit:true});h.vault.invalidateToken('old')
  h.app.globalData.accountSaveIntent={source:'ACCOUNT_SWITCH',scope:h.vault.scope(),kind:'REAUTH',expectedId:'u2'}
  const page=h.page('login');page.onShow()
  if(reason==='server')h.vaultConfig.baseUrl='https://other.example.test/api/v1'
  page.onWechatLogin();await flush()
  if(reason==='match')assert.equal(h.vault.session('u2').token,'new-token')
  else {assert.equal(h.vault.session('u3'),null);assert.equal(h.vault.list().some(row=>!row.requiresLogin),false)}
 }
})


test('普通邮箱登录或仅打开切换导航都不会授权保存账号',async()=>{
 const h=createFlow({realVault:true,profile:{communityKey:'u4',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}})
 h.app.globalData.accountSwitchFlow=true
 const page=h.page('login');page.onShow();page.setData({email:'test@example.test',emailCode:'123456'})
 page.onConfirmEmailLogin();await flush()
 assert.equal(h.app.globalData.isLoggedIn,true);assert.equal(h.vault.list().length,0)
})

test('资料校验失败不保存，退出重置后可重新普通登录，不沿用旧添加意图',async()=>{
 const options={realVault:true,profileError:Error('profile unavailable'),profile:{communityKey:'u2',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}}
 const h=createFlow(options)
 h.app.globalData.accountSaveIntent={source:'ACCOUNT_SWITCH',scope:h.vault.scope(),kind:'ADD',expectedId:''}
 const page=h.page('login');page.onShow();page.onWechatLogin();await flush()
 assert.equal(h.vault.list().length,0);assert.equal(h.app.globalData.accountSaveIntent,null)
 options.profileError=null;page.onWechatLogin();await flush()
 assert.equal(h.app.globalData.isLoggedIn,true);assert.equal(h.vault.list().length,0)
})

test('旧登录响应不能借用之后新建的添加账号意图',async()=>{
 const h=createFlow({realVault:true,profile:{communityKey:'u2',accountStatus:1,disclaimerAgreed:true,disclaimerVersion:'v1'}})
 h.app.globalData.accountSaveIntent={source:'ACCOUNT_SWITCH',scope:h.vault.scope(),kind:'ADD',expectedId:''}
 const page=h.page('login');page.onShow();page.onWechatLogin()
 const newer={source:'ACCOUNT_SWITCH',scope:h.vault.scope(),kind:'ADD',expectedId:''}
 h.app.globalData.accountSaveIntent=newer;page.onShow();await flush()
 assert.equal(h.vault.list().length,0);assert.equal(h.app.globalData.accountSaveIntent,newer)
})
