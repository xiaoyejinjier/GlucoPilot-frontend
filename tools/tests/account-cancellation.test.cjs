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
    '../../utils/storage':{saveUserInfo(){}}
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
function pageHarness(options={}){
  const state={toasts:[],modals:[],navs:[],switchTabs:[],calls:[],reset:0,cleared:0}
  const app={globalData:{isLoggedIn:true,disclaimerRequired:false},resetLoginState(){state.reset++;this.globalData.isLoggedIn=false}}
  const impl={
    fetchCancellationStatus:async()=>({
      accountStatus:1, cancellation:null,
      hasPhone:true, hasEmail:false, hasWechat:true,
      phoneMasked:'138****0000', emailMasked:''
    }),
    fetchCancellationCaptcha:async()=>({ticket:'ticket-1',expiresIn:180}),
    sendCancellationCode:async(channel)=>({
      channel, maskedTarget: channel===1?'138****0000':'a***@qq.com', cooldownSeconds:60
    }),
    submitCancellation:async()=>({accountStatus:2,mode:1}),
    recoverCancellation:async()=>({accountStatus:1}),
    logoutRemote:async()=>null,
    ...options
  }
  const api=Object.fromEntries(Object.entries(impl).map(([key,fn])=>[key,(...args)=>{state.calls.push({key,args});return fn(...args)}]))
  const wx={
    showToast:o=>state.toasts.push(o.title),
    showLoading(){},hideLoading(){},
    showModal:o=>state.modals.push(o),
    reLaunch:o=>state.navs.push(o),
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
  p.onLoad()
  p.onShow()
  return {p,state,app}
}

const submitted=(state)=>state.calls.filter(c=>c.key==='submitCancellation')
const sendCalls=(state)=>state.calls.filter(c=>c.key==='sendCancellationCode')
const captchaCalls=(state)=>state.calls.filter(c=>c.key==='fetchCancellationCaptcha')

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

test('说明页：滑动未完成不取票不发码，完成后带票据发码并按 mode=1 提交',async()=>{
  const {p,state}=pageHarness();await flush()
  assert.equal(p.data.page,'applying')
  assert.equal(p.data.verifyMode,1)
  assert.equal(p.data.codeChannel,1)

  p.onSubmit()
  assert.equal(submitted(state).length,0)
  assert.match(state.toasts.pop(),/勾选/)

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

  p.onToggleAgree()
  p.onSubmit()
  assert.equal(submitted(state).length,0)
  assert.match(state.toasts.pop(),/6 位验证码/)

  p.setData({verifyCode:'123456'})
  p.onSelectReason({currentTarget:{dataset:{code:2}}})
  p.onSubmit()
  assert.equal(state.modals.length,1)
  assert.match(state.modals[0].content,/立即注销/)

  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[1,2,1,'123456',undefined])
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('说明页：mode=2 提交前二次确认文案，原因可留空',async()=>{
  const {p,state}=pageHarness();await flush()
  p.onSelectMode({currentTarget:{dataset:{mode:2}}})
  assert.equal(p.data.mode,2)
  p.onToggleAgree()
  p.onSendCode()
  p.onSliderUnlock();await flush()
  p.setData({verifyCode:'654321'})
  p.onSubmit()
  assert.match(state.modals[0].content,/7 天内可再次登录/)
  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[2,undefined,1,'654321',undefined])
})

test('说明页：滑块取消不发码',async()=>{
  const {p,state}=pageHarness();await flush()
  p.onSendCode()
  assert.equal(p.data.sliderVisible,true)
  p.onSliderCancel()
  assert.equal(p.data.sliderVisible,false)
  assert.equal(captchaCalls(state).length,0)
  assert.equal(sendCalls(state).length,0)
  assert.equal(p.data.smsCooldown,0)
})

test('说明页：切换验证方式清空另一模式的输入，不串扰',async()=>{
  const {p}=pageHarness();await flush()
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

test('说明页：纯微信账号隐藏手机/邮箱验证，wx.login 后按 verifyType=3 提交',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:1,cancellation:null,
      hasPhone:false,hasEmail:false,hasWechat:true,
      phoneMasked:'',emailMasked:''
    })
  })
  await flush()
  assert.equal(p.data.canUseCode,false)
  assert.equal(p.data.verifyMode,3)

  p.onWechatVerify();await flush()
  assert.equal(p.data.wechatVerified,true)

  p.onToggleAgree()
  p.onSubmit()
  assert.match(state.modals[0].content,/立即注销/)
  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(submitted(state)[0].args,[1,undefined,3,undefined,'wx-code-1'])
})

test('说明页：既无手机/邮箱也无微信时提示无法验证',async()=>{
  const {p,state}=pageHarness({
    fetchCancellationStatus:async()=>({
      accountStatus:0,cancellation:null,
      hasPhone:false,hasEmail:false,hasWechat:false,
      phoneMasked:'',emailMasked:''
    })
  })
  await flush()
  assert.equal(p.data.verifyMode,0)
  assert.equal(p.data.canUseCode,false)
  assert.equal(p.data.canUseWechat,false)

  p.onToggleAgree()
  p.onSubmit()
  assert.equal(submitted(state).length,0)
  assert.match(state.toasts.pop(),/请联系客服/)
})

test('说明页：微信 code 一次性有效，提交失败后须重新验证',async()=>{
  let fail=true
  const {p,state}=pageHarness({
    submitCancellation:async()=>{if(fail)throw new Error('微信身份验证失败');return {accountStatus:2,mode:1}}
  })
  await flush()
  p.onSwitchVerifyMode({currentTarget:{dataset:{mode:3}}})
  p.onWechatVerify();await flush()
  assert.equal(p.data.wechatVerified,true)
  p.onToggleAgree()
  p.onSubmit()
  state.modals[0].success({confirm:true});await flush()
  assert.equal(p.data.wechatVerified,false)
  assert.equal(p.data.submitting,false)
  assert.equal(submitted(state).length,1)

  p.onWechatVerify();await flush()
  fail=false
  p.onSubmit()
  state.modals[1].success({confirm:true});await flush()
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('可恢复窗口：展示到期时间，确认后免验证码恢复并回记录页',async()=>{
  const flag={recovered:false}
  const {p,state}=pageHarness({
    fetchCancellationStatus:async()=>flag.recovered
      ? {accountStatus:1,cancellation:{mode:2,status:3}}
      : {accountStatus:4,cancellation:{mode:2,status:0,isolateUntil:String(Date.now()+7*DAY)}},
    recoverCancellation:async()=>{flag.recovered=true;return {accountStatus:1}}
  })
  await flush()
  assert.equal(p.data.page,'pending')
  assert.match(p.data.deadline,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

  p.onRecover()
  assert.equal(state.calls.filter(c=>c.key==='recoverCancellation').length,0)
  assert.equal(state.modals.length,1)
  state.modals[0].success({confirm:true});await flush()
  assert.deepEqual(state.calls.filter(c=>c.key==='recoverCancellation')[0].args,[])
  assert.equal(state.switchTabs[0].url,'/pages/ai/ai')
})

test('可恢复窗口：恢复后仍禁用，仅可继续注销或退出',async()=>{
  let recovered=false
  const {p,state}=pageHarness({
    fetchCancellationStatus:async()=>recovered
      ? {accountStatus:0,cancellation:{mode:2,status:2},hasPhone:false,hasEmail:false,hasWechat:true}
      : {accountStatus:4,cancellation:{mode:2,status:0,isolateUntil:String(Date.now()+DAY)}},
    recoverCancellation:async()=>{recovered=true;return {accountStatus:0}}
  })
  await flush()
  p.onRecover()
  state.modals[0].success({confirm:true});await flush()
  const disabled=state.modals[1]
  assert.equal(disabled.title,'注销已取消')
  disabled.success({confirm:true});await flush()
  assert.equal(p.data.page,'applying')

  p.onExit();await flush()
  assert.equal(state.reset,1)
  assert.equal(state.cleared,1)
  assert.match(state.navs[0].url,/pages\/login\/login/)
})

test('禁用账号直达说明页仍走申请流',async()=>{
  const {p}=pageHarness({fetchCancellationStatus:async()=>({
    accountStatus:0,cancellation:null,
    hasPhone:true,hasEmail:false,hasWechat:true,
    phoneMasked:'138****0000',emailMasked:''
  })})
  await flush()
  assert.equal(p.data.page,'applying')
  assert.equal(p.data.verifyMode,1)
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
