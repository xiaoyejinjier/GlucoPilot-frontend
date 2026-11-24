const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const DAY=24*3600*1000

/** 账号安全页：注销入口仅展示状态并跳转独立说明页，流程不再在页内完成。 */
function securityHarness(options={}){
  const state={toasts:[],navs:[],calls:[]}
  const impl={
    fetchMe:async()=>({phoneMasked:'138****0000',emailMasked:'***'}),
    sendSmsCode:async()=>{},
    bindPhone:async()=>({}),
    sendEmailCode:async()=>{},
    bindEmail:async()=>({}),
    fetchCancellationStatus:async()=>({accountStatus:1,cancellation:null}),
    ...options
  }
  const api=Object.fromEntries(Object.entries(impl).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
  const wx={showToast:o=>state.toasts.push(o.title),navigateTo:o=>state.navs.push(o.url),showLoading(){},hideLoading(){}}
  const deps={
    '../../services/api':api,
    '../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../utils/storage':{saveUserInfo(){},getLoginChannel:()=>'phone'}
  }
  let def
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/account-security/account-security.js'),'utf8'),{
    Page:x=>def=x,getApp:()=>({}),wx,require:k=>{assert.ok(deps[k],k);return deps[k]},setInterval(){return 0},clearInterval(){}
  })
  const p={...def,data:JSON.parse(JSON.stringify(def.data))}
  p.setData=function(v){Object.assign(this.data,v)}
  p.onShow()
  return {p,state}
}

/** 注销说明页：验证方式切换、滑动取票发码与可恢复窗口。 */
function pageHarness(options={},loadOptions={}){
  const state={toasts:[],modals:[],navs:[],notices:[],switchTabs:[],calls:[],reset:0,cleared:0}
  const app={globalData:{isLoggedIn:true,disclaimerRequired:false},resetLoginState(){state.reset++;this.globalData.isLoggedIn=false}}
  const impl={
    fetchCancellationStatus:async()=>({
      accountStatus:1, cancellation:null,
      hasPhone:true, hasEmail:false, hasWechat:true,
      phoneMasked:'138****0000', emailMasked:''
    }),
    fetchCancellationPrecheck:async()=>({canCancel:true,checks:[]}),
    fetchCancellationCaptcha:async()=>({ticket:'ticket-1',expiresIn:180}),
    sendCancellationCode:async(channel)=>({
      channel, maskedTarget: channel===1?'138****0000':'a***@qq.com', cooldownSeconds:60
    }),
    submitCancellation:async()=>({accountStatus:4,mode:2}),
    logoutRemote:async()=>null,
    ...options
  }
  const api=Object.fromEntries(Object.entries(impl).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
  const wx={
    showToast:o=>state.toasts.push(o.title),
    showLoading(){},hideLoading(){},
    showModal:o=>state.modals.push(o),
    reLaunch:o=>state.navs.push(o),
    navigateTo:o=>state.notices.push(o.url),
    switchTab:o=>state.switchTabs.push(o),
    login:o=>{if(o&&o.success)o.success({code:(typeof options.wechatCode==='function')?options.wechatCode():'wx-code-1'})}
  }
  const deps={
    '../../services/api':api,
    '../../utils/display':{applyDisplayToCurrentPage(){}},
    '../../utils/storage':{clearAccountCache(){state.cleared++}},
    '../../utils/i18n':{getLocale:()=> 'zh',t:v=>v}
  }
  let def
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/account-cancellation/cancellation.js'),'utf8'),{
    Page:x=>def=x,getApp:()=>app,wx,require:k=>{assert.ok(deps[k],k);return deps[k]},setInterval(){return 0},clearInterval(){}
  })
  const p={...def,data:JSON.parse(JSON.stringify(def.data))}
  p.setData=function(v){Object.assign(this.data,v)}
  p.onLoad(loadOptions||{})
  p.onShow()
  return {p,state,app}
}

const submitted=(state)=>state.calls.filter(c=>c.key==='submitCancellation')
const sendCalls=(state)=>state.calls.filter(c=>c.key==='sendCancellationCode')
const captchaCalls=(state)=>state.calls.filter(c=>c.key==='fetchCancellationCaptcha')
const precheckCalls=(state)=>state.calls.filter(c=>c.key==='fetchCancellationPrecheck')
const statusCalls=(state)=>state.calls.filter(c=>c.key==='fetchCancellationStatus')

/** 说明页勾选并点【申请注销】，等预检结果（已勾选时不再重复切换）。 */
async function applyFromIntro(p){
  if (!p.data.agreed) p.onToggleAgree()
  p.onApply()
  await flush()
}

/** 说明页勾选并点【申请注销】：预检通过后应 push 一个 step=verify 的同路由栈层。 */
async function openVerify(intro){
  await applyFromIntro(intro.p)
  const url=intro.state.notices.at(-1)||''
  assert.match(url,/step=verify/)
  return url
}

/** 直接构造身份验证栈层（上一页已勾选并通过预检）。 */
async function verifyHarness(options={},reasonCode){
  const h=pageHarness(options,{step:'verify',reasonCode:reasonCode?String(reasonCode):''})
  await flush()
  return h
}

test('账号安全页：注销入口跳转独立说明页',async()=>{
  const {p,state}=securityHarness();await flush()
  assert.equal(p.data.recoverable,false)
  p.onOpenCancel()
  assert.equal(state.navs[0],'/pages/account-cancellation/cancellation')
})

test('账号安全页：注销处理中（accountStatus=4）入口显示申请处理中',async()=>{
  const {p,state}=securityHarness({
    fetchCancellationStatus:async()=>({accountStatus:4,cancellation:{mode:2,status:0,isolateUntil:String(Date.now()+7*DAY)}})
  })
  await flush()
  assert.equal(p.data.recoverable,true)
  assert.equal(state.toasts.length,0)
})

test('账号安全页：绑定手机号走 bind scene，校验手机号与验证码',async()=>{
  const {p,state}=securityHarness();await flush()
  p.onBindPhone()
  p.setData({newPhone:'123'})
  p.onSendSms()
  assert.match(state.toasts.pop(),/请输入正确手机号/)

  p.setData({newPhone:'13900000000'})
  p.onSendSms();await flush()
  assert.deepEqual(state.calls.filter(c=>c.key==='sendSmsCode')[0].args,['13900000000','bind'])
  assert.equal(p.data.smsCooldown,60)

  p.setData({smsCode:'123456'})
  p.onConfirmBind();await flush()
  assert.deepEqual(state.calls.filter(c=>c.key==='bindPhone')[0].args,['13900000000','123456'])
  assert.equal(p.data.panel,false)
})

test('账号安全页：绑定邮箱走 bind scene 并回填脱敏邮箱',async()=>{
  const {p,state}=securityHarness({
    bindEmail:async()=>({emailMasked:'a***@qq.com'})
  });await flush()
  p.onBindEmail()
  p.setData({newEmail:'a@qq.com'})
  p.onSendEmailCode();await flush()
  assert.deepEqual(state.calls.filter(c=>c.key==='sendEmailCode')[0].args,['a@qq.com','bind'])

  p.setData({emailCode:'123456'})
  p.onConfirmBindEmail();await flush()
  assert.deepEqual(state.calls.filter(c=>c.key==='bindEmail')[0].args,['a@qq.com','123456'])
  assert.equal(p.data.email,'a***@qq.com')
})

test('说明页：未勾选不发预检；勾选后预检通过 push 身份验证栈层，验证内固定 mode=2 提交',async()=>{
  const intro=pageHarness();await flush()
  assert.equal(intro.p.data.page,'applying')
  assert.equal(intro.p.data.step,'intro')
  assert.equal(intro.p.data.verifyMode,1)
  assert.equal(intro.p.data.codeChannel,1)

  intro.p.onApply()
  assert.match(intro.state.toasts.pop(),/注销须知/)
  assert.equal(intro.state.notices.length,0)
  // intro 页加载时会后台预检一次以展示未满足条件，点击按钮本身不应额外触发
  const beforeClick=precheckCalls(intro.state).length
  assert.ok(beforeClick>=1)

  const url=await openVerify(intro)
  assert.equal(precheckCalls(intro.state).length,beforeClick+1)
  assert.match(url,/pages\/account-cancellation\/cancellation\?step=verify/)
  // 说明页自身仍停留在 intro：系统返回后不丢勾选与原因
  assert.equal(intro.p.data.step,'intro')

  const {p,state}=await verifyHarness({},2)
  assert.equal(p.data.step,'verify')
  assert.equal(p.data.agreed,true)
  assert.equal(p.data.reasonCode,2)

  p.onSendCode()
  // 只弹滑块：滑动成功前不得取票、不得发码
  assert.equal(p.data.sliderVisible,true)
  assert.equal(captchaCalls(state).length,0)
  assert.equal(sendCalls(state).length,0)

  p.onSliderUnlock();await flush()
  assert.equal(p.data.sliderVisible,false)
  assert.equal(captchaCalls(state).length,1)
  assert.deepEqual(sendCalls(state)[0].args,[1,'ticket-1'])
  assert.equal(p.data.smsCooldown,60)
  assert.equal(p.data.cooldownLeft,60)
  assert.equal(p.data.phoneTarget,'138****0000')
  assert.equal(p.data.targetHint,'验证码将发送至手机 138****0000')

  p.onConfirmSubmit()
  assert.equal(submitted(state).length,0)
  assert.match(state.toasts.pop(),/6 位验证码/)

  p.setData({verifyCode:'123456'})
  p.onConfirmSubmit()
  assert.equal(state.modals.length,1)
  assert.match(state.modals[0].content,/7 天内可再次登录/)

  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[2,2,1,'123456',undefined])
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('身份验证页：提交前二次确认文案为七天可恢复，原因可留空',async()=>{
  const {p,state}=await verifyHarness()
  p.onSendCode()
  p.onSliderUnlock();await flush()
  p.setData({verifyCode:'654321'})
  p.onConfirmSubmit()
  assert.match(state.modals[0].content,/7 天内可再次登录/)
  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[2,undefined,1,'654321',undefined])
})

test('身份验证页：滑块取消不发码',async()=>{
  const {p,state}=await verifyHarness()
  p.onSendCode()
  assert.equal(p.data.sliderVisible,true)
  p.onSliderCancel()
  assert.equal(p.data.sliderVisible,false)
  assert.equal(captchaCalls(state).length,0)
  assert.equal(sendCalls(state).length,0)
  assert.equal(p.data.smsCooldown,0)
})

test('身份验证页：切换验证方式清空另一模式的输入，不串扰',async()=>{
  const {p}=await verifyHarness()
  p.onSendCode()
  p.onSliderUnlock();await flush()
  p.setData({verifyCode:'123456'})

  p.onSwitchVerifyMode({currentTarget:{dataset:{mode:3}}})
  assert.equal(p.data.verifyMode,3)
  assert.equal(p.data.verifyCode,'')
  assert.equal(p.data.wechatVerified,false)

  p.onSwitchVerifyMode({currentTarget:{dataset:{mode:1}}})
  assert.equal(p.data.verifyMode,1)
  assert.equal(p.data.verifyCode,'')
  // 冷却按通道独立保留，切回来仍受服务端 60 秒限制
  assert.equal(p.data.smsCooldown,60)
  assert.equal(p.data.cooldownLeft,60)
})

test('身份验证页：纯微信账号隐藏手机/邮箱验证，wx.login 后按 verifyType=3 提交',async()=>{
  const {p,state}=await verifyHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:1,cancellation:null,
      hasPhone:false,hasEmail:false,hasWechat:true,
      phoneMasked:'',emailMasked:''
    })
  })
  assert.equal(p.data.canUseCode,false)
  assert.equal(p.data.verifyMode,3)

  p.onWechatVerify();await flush()
  assert.equal(p.data.wechatVerified,true)

  p.onConfirmSubmit()
  assert.match(state.modals[0].content,/7 天内可再次登录/)
  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[2,undefined,3,undefined,'wx-code-1'])
})

test('身份验证页：既无手机/邮箱也无微信时提示无法验证',async()=>{
  const {p,state}=await verifyHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:0,cancellation:null,
      hasPhone:false,hasEmail:false,hasWechat:false,
      phoneMasked:'',emailMasked:''
    })
  })
  assert.equal(p.data.verifyMode,0)
  assert.equal(p.data.canUseCode,false)
  assert.equal(p.data.canUseWechat,false)

  p.onConfirmSubmit()
  assert.equal(submitted(state).length,0)
  assert.match(state.toasts.pop(),/请联系客服/)
})

test('身份验证页：微信 code 一次性有效，提交失败后须重新验证',async()=>{
  let fail=true
  const {p,state}=await verifyHarness({
    submitCancellation:async()=>{if(fail)throw new Error('微信身份验证失败');return {accountStatus:4,mode:2}}
  })
  p.onSwitchVerifyMode({currentTarget:{dataset:{mode:3}}})
  p.onWechatVerify();await flush()
  assert.equal(p.data.wechatVerified,true)
  p.onConfirmSubmit()
  state.modals[0].success({confirm:true});await flush()
  assert.equal(p.data.wechatVerified,false)
  assert.equal(p.data.submitting,false)
  assert.equal(submitted(state).length,1)

  p.onWechatVerify();await flush()
  fail=false
  p.onConfirmSubmit()
  state.modals[1].success({confirm:true});await flush()
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('可恢复窗口：只展示到期时间与"登录即取消"提示，不再提供手动恢复',async()=>{
  const {p}=pageHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:4,cancellation:{mode:2,status:0,isolateUntil:String(Date.now()+7*DAY)}
    })
  })
  await flush()
  assert.equal(p.data.page,'pending')
  assert.match(p.data.deadline,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  // 手动恢复入口已下线：页面对象上不得再有 onRecover
  assert.equal(typeof p.onRecover,'undefined')
  assert.equal(typeof p.onSelectMode,'undefined')
})

test('说明页：封禁账号可进入说明页，点击申请注销被预检拦截',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:0,cancellation:null,
      hasPhone:true,hasEmail:false,hasWechat:true,
      phoneMasked:'138****0000',emailMasked:''
    }),
    fetchCancellationPrecheck:async()=>({
      canCancel:false,blockCode:'ACCOUNT_DISABLED',
      blockMessage:'账号已被封禁，请联系客服申请解冻后再注销'
    })
  })
  await flush()
  assert.equal(p.data.page,'applying')
  assert.equal(p.data.verifyMode,1)

  await applyFromIntro(p)
  assert.equal(p.data.step,'intro')
  assert.equal(state.modals.length,1)
  assert.equal(state.modals[0].title,'账号已被封禁')
  assert.match(state.modals[0].content,/联系客服/)
})

test('说明页：预检 ALREADY_APPLIED 直接切注销处理中并带到期时间',async()=>{
  const deadline=String(Date.now()+7*DAY)
  const {p}=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'ALREADY_APPLIED',isolateUntil:deadline})
  })
  await flush()
  await applyFromIntro(p)
  assert.equal(p.data.page,'pending')
  assert.match(p.data.deadline,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('说明页：预检 ALREADY_APPLIED 缺时间字段时回查状态接口',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'ALREADY_APPLIED'})
  })
  await flush()
  const before=statusCalls(state).length
  await applyFromIntro(p)
  assert.equal(statusCalls(state).length,before+1)
  assert.equal(p.data.page,'applying')
  assert.equal(p.data.step,'intro')
})

test('说明页：预检恢复后 24h 锁定，停留在说明页',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'RECENTLY_RECOVERED'})
  })
  await flush()
  await applyFromIntro(p)
  assert.equal(p.data.step,'intro')
  assert.match(state.modals[0].content,/24 小时/)
})

test('说明页：预检资产未结清，停留在说明页',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'ASSET_PENDING',blockMessage:'存在未结清资产'})
  })
  await flush()
  await applyFromIntro(p)
  assert.equal(p.data.step,'intro')
  assert.match(state.modals[0].content,/未结清资产/)
})

test('说明页：预检注销态切 gone 视图，不弹窗',async()=>{
  const cancelling=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'CANCELLING'})
  })
  await flush()
  await applyFromIntro(cancelling.p)
  assert.equal(cancelling.p.data.page,'gone')
  assert.equal(cancelling.state.modals.length,0)

  const cancelled=pageHarness({
    fetchCancellationPrecheck:async()=>({canCancel:false,blockCode:'ACCOUNT_CANCELLED'})
  })
  await flush()
  await applyFromIntro(cancelled.p)
  assert.equal(cancelled.p.data.page,'gone')
  assert.equal(cancelled.state.modals.length,0)
})

test('说明页：预检请求失败只提示，不进入验证步骤',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationPrecheck:async()=>{throw new Error('boom')}
  })
  await flush()
  await applyFromIntro(p)
  assert.equal(p.data.step,'intro')
  assert.equal(p.data.checking,false)
  assert.match(state.toasts.pop(),/boom|失败/)
})

test('说明页：原生返回回到本页时，勾选与原因保持并可再次进入验证',async()=>{
  const intro=pageHarness()
  await flush()
  intro.p.onSelectReason({currentTarget:{dataset:{code:3}}})
  const url=await openVerify(intro)
  assert.match(url,/reasonCode=3/)

  // 系统返回：说明页重新 onShow，表单状态不丢
  intro.p.onShow();await flush()
  assert.equal(intro.p.data.step,'intro')
  assert.equal(intro.p.data.agreed,true)
  assert.equal(intro.p.data.reasonCode,3)

  const again=await openVerify(intro)
  assert.match(again,/reasonCode=3/)
})

test('说明页：须知页可打开，返回触发 onShow 不重置勾选与原因',async()=>{
  const {p,state}=pageHarness()
  await flush()
  p.onOpenNotice()
  assert.equal(state.notices[0],'/pages/account-cancellation-notice/notice')

  p.onToggleAgree()
  p.onSelectReason({currentTarget:{dataset:{code:2}}})
  p.onShow();await flush()
  assert.equal(p.data.step,'intro')
  assert.equal(p.data.agreed,true)
  assert.equal(p.data.reasonCode,2)
})

test('状态查询失败不展示申请入口，仅可退出',async()=>{
  const {p,state}=pageHarness({fetchCancellationStatus:async()=>{throw new Error('boom')}})
  await flush()
  assert.equal(p.data.page,'error')
  p.onExit();await flush()
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('绑定标志缺失（契约不匹配）时提示版本不兼容，不渲染未绑定文案',async()=>{
  const {p,state}=pageHarness({fetchCancellationStatus:async()=>({accountStatus:1,cancellation:null})})
  await flush()
  assert.equal(p.data.page,'error')
  assert.match(p.data.errorText,/版本不兼容/)
  assert.match(state.toasts.pop(),/版本不兼容/)
})
