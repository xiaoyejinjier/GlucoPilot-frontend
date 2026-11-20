const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const helpers = require('../../utils/consultation')
const previewCaps = { mode:'PREVIEW', submissionEnabled:false, paymentEnabled:false, feeCents:100 }
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve() }

test('我的问诊区分待接诊、已接诊和已有问诊单，交流直达对应会话',async()=>{
 const h=harness('consultation-records',{list:async()=>({records:[{id:'1',status:'WAITING',title:'问题一'},{id:'2',status:'IN_PROGRESS',title:'问题二'},{id:'3',status:'REPORT_READY',title:'问题三'}],pages:1})})
 h.page.onLoad({});h.page.onShow();await flush()
 assert.equal(h.page.data.records[0].statusTone,'waiting');assert.equal(h.page.data.records[0].hasDoctor,false)
 assert.equal(h.page.data.records[1].statusTone,'active');assert.equal(h.page.data.records[1].hasDoctor,true)
 assert.equal(h.page.data.records[2].reportReady,true);assert.equal(h.page.data.records[2].statusTone,'report')
 h.page.onChat({currentTarget:{dataset:{id:'1'}}});assert.equal(h.state.navs.length,0)
 h.page.onChat({currentTarget:{dataset:{id:'2'}}});assert.equal(h.state.navs[0].url,'/pages/consultation-chat/consultation-chat?id=2')
 h.page.onOpen({currentTarget:{dataset:{id:'3'}}});assert.equal(h.state.navs[1].url,'/pages/consultation-detail/consultation-detail?id=3')
})

function harness(name, overrides = {}) {
  let definition
  const state = { token:'user-one', publishes:[], orders:[], modals:[], navs:[], selected:[], patches:[], keyboardHides:0, scrolls:[],timers:new Map(),uploads:[], storage:new Map(),reads:[],notificationRefreshes:0,keyboardHandlers:new Set() }
  const request = { getToken:()=>state.token }
  const social = { exports:{} }
  const wx = { getStorageSync:key=>state.storage.get(key), setStorageSync:(key,value)=>state.storage.set(key,value), showToast(){}, showModal:value=>state.modals.push(value),
    getWindowInfo:()=>({windowHeight:700}), onKeyboardHeightChange:fn=>state.keyboardHandlers.add(fn),offKeyboardHeightChange:fn=>state.keyboardHandlers.delete(fn),
    navigateTo:value=>state.navs.push(value), redirectTo:value=>state.navs.push(value), stopPullDownRefresh(){}, hideKeyboard(){state.keyboardHides++}, nextTick:callback=>Promise.resolve().then(callback), pageScrollTo:value=>state.scrolls.push(value),chooseMedia:args=>args.success({tempFiles:[{tempFilePath:'private-photo.jpg'}]}) }
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/community.js'),'utf8'), {
    module:social,require:()=>request,wx,getApp:()=>({})
  })
  const api = { PREVIEW_CAPABILITIES:previewCaps, capabilities:async()=>previewCaps,doctor:async()=>null,
    list:async()=>({records:[],pages:0}),orders:async()=>({records:[],pages:0}),images:async()=>[],messages:async()=>({records:[],canSend:true,hasMore:false}),
    readMessages:async(...args)=>state.reads.push(args),conversations:async()=>({records:[],pages:0}),
    publish:async body=>state.publishes.push(body), createOrder:async body=>state.orders.push(body), ...overrides }
  const deps = { '../../services/consultation':api,'../../utils/consultation':helpers,
    '../../services/wallet': { summary: async()=>({ activated: true, balanceCents: 1000 }), ...overrides.wallet },
    '../../utils/community':social.exports,'../../utils/request':request,
    '../../utils/message-notifications':{refresh:()=>{state.notificationRefreshes++;return Promise.resolve()}},
    '../../utils/consultation-media':{loadPhoto:async url=>url},
    '../../utils/media':{BIZ_TYPE:{CONSULTATION_IMAGE:9},MAX_IMAGE_BYTES:5242880,uploadMediaFile:async(...args)=>{state.uploads.push(args);return overrides.uploadMediaFile?overrides.uploadMediaFile(...args):{id:'12'}}},
    '../../utils/display':{applyDisplayToCurrentPage(){}} }
  vm.runInNewContext(fs.readFileSync(path.join(root,`pages/${name}/${name}.js`),'utf8'), {
    Page:value=>{definition=value},wx,getApp:()=>({checkLogin:()=>!!state.token}),require:key=>deps[key],setInterval:(fn,ms)=>{const id=state.timers.size+1;state.timers.set(id,{fn,ms});return id},clearInterval:id=>state.timers.delete(id)
  })
  const page = { ...definition,data:structuredClone(definition.data),
    getTabBar:()=>({setData:value=>state.selected.push(value.selected)}),
    setData(data, callback) {
      state.patches.push(data)
      for (const [key,value] of Object.entries(data)) {
        const parts=key.split('.');let target=this.data
        for (const part of parts.slice(0,-1)) target=target[part]
        target[parts.at(-1)]=value
      }
      if (callback) callback()
    } }
  return {page,state,api,wx}
}

test('发布求助必填校验失败自动定位底部提示，不调用发布接口',async()=>{
  const {page,state}=harness('consultation-compose')
  page.onShow();await flush()
  await page.onSubmit();await flush()
  assert.equal(page.data.error,'请用至少4个字概括你的问题')
  assert.equal(state.scrolls.at(-1).selector,'#consultation-submit-error')
  page.onInput({currentTarget:{dataset:{field:'title'}},detail:{value:'最近血糖情况'}})
  await page.onSubmit();await flush()
  assert.equal(page.data.error,'请补充至少10个字的问题描述')
  assert.equal(state.scrolls.length,2);assert.equal(state.keyboardHides,2)
  assert.equal(state.publishes.length,0)
  const markup=fs.readFileSync(path.join(root,'pages/consultation-compose/consultation-compose.wxml'),'utf8')
  assert.match(markup,/wx:if="\{\{error\}\}" id="consultation-submit-error"/)
})

test('发布被限制后自动定位服务端提示，保留表单、图片和重试编号；成功不滚动',async()=>{
  let denied=true;const requests=[]
  const {page,state}=harness('consultation-compose',{
    capabilities:async()=>({submissionEnabled:true}),
    publish:async body=>{requests.push(body);if(denied)throw new Error('今日发布次数已达上限')}
  })
  page.onShow();await flush()
  page.setData({'form.title':'最近血糖情况','form.symptoms':'希望了解最近几天餐后血糖变化的情况。',images:[{mediaId:'12',url:'local.jpg'}]})
  const form=page.data.form,images=page.data.images
  await page.onSubmit();await flush()
  assert.equal(page.data.error,'今日发布次数已达上限')
  assert.equal(state.scrolls.length,1);assert.equal(state.scrolls[0].selector,'#consultation-submit-error')
  assert.equal(page.data.form,form);assert.equal(page.data.images,images);assert.equal(page.data.saving,false)
  denied=false;await page.onSubmit();await flush()
  assert.equal(requests[0].clientRequestId,requests[1].clientRequestId)
  assert.equal(state.scrolls.length,1);assert.match(state.navs[0].url,/consultation-records/)
})

test('底部提示等待渲染再滚动，离页或修改内容后取消迟到定位',async()=>{
  const {page,state}=harness('consultation-compose')
  page.onShow();await flush()
  const apply=page.setData.bind(page);let rendered
  page.setData=(data,callback)=>{apply(data);if(callback)rendered=callback}
  await page.onSubmit();await flush();assert.equal(state.scrolls.length,0)
  rendered();await flush();assert.equal(state.scrolls.length,1)
  await page.onSubmit();page.onHide();rendered();await flush()
  assert.equal(state.scrolls.length,1)
  state.token='user-two';page.onShow();await flush()
  await page.onSubmit()
  page.onInput({currentTarget:{dataset:{field:'title'}},detail:{value:'已经修改标题'}})
  rendered();await flush();assert.equal(state.scrolls.length,1)
})

test('设备移入我的，问诊占用第二个Tab，保留设备页面及其返回栈',()=>{
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
  assert.equal(app.tabBar.list[1].pagePath,'pages/consultation/consultation')
  assert.equal(app.tabBar.list[1].text,'问诊')
  assert.equal(app.tabBar.list.some(item=>item.pagePath==='pages/devices/devices'),false)
  assert.equal(app.pages.includes('pages/devices/devices'),true)
  const mine=fs.readFileSync(path.join(root,'pages/mine/mine.wxml'),'utf8')
  assert.match(mine,/bindtap="onDevicesTap"/)
  assert.match(mine,/data-url="\/pages\/consultation-records\/consultation-records"/)
})

test('医生申请提交只更新状态，不清空重载表单或新增上方状态卡，保留输入与布局',async()=>{
  let reads=0, release
  const {page,state}=harness('consultation-doctor',{
    doctor:async()=>{reads++;return null},
    applyDoctor:body=>new Promise(resolve=>{release=()=>resolve({...body,status:'PENDING'})})
  })
  page.onShow();await flush()
  const form={realName:'测试医生',hospital:'测试医院',specialty:'内分泌科',licenseNumber:'test-license',qualificationNote:'资质说明'.repeat(100)}
  page.setData({form});state.patches=[]
  const sending=page.onApply();await flush()
  assert.equal(state.keyboardHides,1);assert.equal(page.data.saving,true)
  assert.equal(page.data.canEdit,true);assert.equal(page.data.form,form)
  assert.equal(state.patches.some(p=>p.loading===true||p.canEdit===false||Object.hasOwn(p,'form')),false)
  release();await sending
  assert.equal(reads,1);assert.equal(page.data.form,form);assert.equal(page.data.statusLabel,'待审核')
  assert.equal(page.data.canEdit,true);assert.equal(page.data.saving,false)
  assert.equal(state.patches.some(p=>Object.hasOwn(p,'form')||p.profile===null),false)
  const markup=fs.readFileSync(path.join(root,'pages/consultation-doctor/consultation-doctor.wxml'),'utf8')
  assert.match(markup,/wx:if="\{\{!loading && !error\}\}" class="consult-card"/)
  assert.match(markup,/医生资质申请/)
})

test('医生申请失败保留填写内容，切换账号后旧申请结果不能覆盖新账号',async()=>{
  let release, failing=true
  const {page,state}=harness('consultation-doctor',{
    doctor:async()=>null,
    applyDoctor:async body=>{if(failing)throw new Error('网络暂不可用');return new Promise(resolve=>{release=()=>resolve({...body,status:'PENDING'})})}
  })
  page.onShow();await flush()
  const form={realName:'测试医生',hospital:'医院',specialty:'科室',licenseNumber:'test',qualificationNote:'说明'}
  page.setData({form});await page.onApply();assert.equal(page.data.form,form);assert.equal(page.data.saving,false)
  failing=false;const pending=page.onApply();await flush()
  page.onHide();state.token='user-two';page.onShow();await flush();release();await pending
  assert.equal(page.data.profile,null);assert.equal(page.data.form.realName,'');assert.equal(page.data.canEdit,true)
})

test('未开通钱包可直接前往开通，返回后重查状态；零余额医生开通后可确认接诊',async()=>{
  let activated=false, claims=0, summaries=0
  const {page,state}=harness('consultation-detail',{
    detail:async()=>({id:'8',title:'求助',status:'WAITING',canClaim:true}),
    wallet:{summary:async()=>{summaries++;return{activated,balanceCents:0}}},
    claim:async()=>{claims++;return{id:'8',status:'IN_PROGRESS',canClaim:false,canReply:true}}
  })
  page.onLoad({id:'8'});page.onShow();await flush()
  assert.equal(page.data.walletReady,true);assert.equal(page.data.walletActivated,false)
  page.onClaim();assert.equal(claims,0);assert.equal(state.modals.length,0)
  assert.equal(state.navs[0].url,'/pages/wallet/wallet')
  page.onHide();activated=true;page.onShow();await flush()
  assert.equal(summaries,2);assert.equal(page.data.walletActivated,true);assert.equal(claims,0)
  page.onClaim();assert.equal(state.modals.at(-1).title,'确认接诊')
  state.modals.at(-1).success({confirm:true});await flush()
  assert.equal(claims,1);assert.equal(page.data.item.canReply,true)
})

test('钱包状态未加载或查询失败不能接诊，重试成功恢复；迟到钱包响应不跨账号',async()=>{
  let release, attempts=0, claims=0
  const {page,state}=harness('consultation-detail',{
    detail:async()=>({id:'8',status:'WAITING',canClaim:true}),
    wallet:{summary:async()=>{attempts++;if(attempts===1)throw new Error('网络暂不可用');return new Promise(resolve=>{release=resolve})}},
    claim:async()=>{claims++}
  })
  page.onLoad({id:'8'});page.onShow();await flush()
  assert.equal(page.data.error,'');assert.equal(page.data.walletReady,false);assert.equal(page.data.walletError,'网络暂不可用')
  page.onClaim();await page.claim();assert.equal(claims,0);assert.equal(state.modals.length,0)
  const retry=page.onWalletRetry();await flush();assert.equal(page.data.walletLoading,true)
  page.onClaim();assert.equal(claims,0)
  release({activated:true});await retry;assert.equal(page.data.walletReady,true);assert.equal(page.data.walletError,'')
  const stale=page.loadWallet();await flush();page.onHide();state.token='user-two';page.onShow();await flush()
  release({activated:false});await stale
  assert.equal(page.data.item,null);assert.equal(page.data.error,'请重新打开问诊记录')
})

test('医生工作台展示真实钱包状态，并提供开通入口；患者浏览不查询医生钱包',async()=>{
  let count=0
  const doctor=harness('consultation-doctor',{
    doctor:async()=>({realName:'测试医生',status:'APPROVED'}),
    wallet:{summary:async()=>{count++;return{activated:false}}}
  })
  doctor.page.onShow();await flush();assert.equal(doctor.page.data.walletReady,true)
  assert.equal(doctor.page.data.walletActivated,false);doctor.page.onWallet()
  assert.equal(doctor.state.navs[0].url,'/pages/wallet/wallet');assert.equal(count,1)
  const patient=harness('consultation-detail',{
    detail:async()=>({id:'8',canClaim:false}),wallet:{summary:async()=>{count++;return{activated:false}}}
  })
  patient.page.onLoad({id:'8'});patient.page.onShow();await flush();assert.equal(count,1)
})

test('医生接诊后直接进入填写流程，不展示患者付款入口，开始填写可定位编辑区',async()=>{
  const {page,state}=harness('consultation-detail',{
    detail:async()=>({id:'8',mine:false,canReply:true,status:'IN_PROGRESS',report:{ready:false,access:'LOCKED',feeCents:100}})
  })
  page.onLoad({id:'8'});page.onShow();await flush()
  assert.equal(page.data.doctorView,true);assert.equal(page.data.showPaymentFooter,false)
  page.onCheckout();assert.equal(state.navs.length,0)
  page.onWriteReport();assert.equal(state.scrolls[0].selector,'#consultation-report-editor')
  page.showItem({id:'8',mine:false,canReply:false,status:'REPORT_READY',report:{id:'10',ready:true,access:'UNLOCKED',assessment:'评估',medicationAdvice:'建议'}})
  assert.equal(page.data.doctorView,true);assert.equal(page.data.unlocked,true);assert.equal(page.data.showPaymentFooter,false)
  assert.equal(page.data.report.assessment,'评估')
  page.onWriteReport();assert.equal(state.scrolls.length,1)
})

test('患者区分等待出单与待支付，未支付不显示问诊正文，解锁后移除支付栏',async()=>{
  const {page,state}=harness('consultation-detail',{detail:async()=>({id:'8',mine:true,canReply:false,report:{ready:false,access:'LOCKED'}})})
  page.onLoad({id:'8'});page.onShow();await flush()
  page.showItem({id:'8',mine:true,canReply:false,report:{ready:false,access:'LOCKED'}})
  assert.equal(page.data.doctorView,false);assert.equal(page.data.showPaymentFooter,false)
  page.showItem({id:'8',mine:true,report:{id:'10',ready:true,access:'LOCKED',assessment:'不应显示',feeCents:100}})
  assert.equal(page.data.doctorView,false);assert.equal(page.data.showPaymentFooter,true);assert.equal(page.data.report.assessment,undefined)
  page.onCheckout();assert.match(state.navs[0].url,/reportId=10$/)
  page.showItem({id:'8',mine:true,report:{id:'10',ready:true,access:'UNLOCKED',assessment:'可见评估',feeCents:100}})
  assert.equal(page.data.doctorView,false);assert.equal(page.data.showPaymentFooter,false)
  assert.equal(page.data.report.assessment,'可见评估')
})

test('医生问诊单发送失败保留内容和请求编号，成功后转只读且不能再次发送',async()=>{
  let attempts=0;const keys=[]
  const {page,state}=harness('consultation-detail',{
    detail:async()=>({id:'8',mine:false,canReply:true,status:'IN_PROGRESS'}),
    issueReport:async(id,body)=>{
      attempts++;keys.push(body.clientRequestId)
      if(attempts===1)throw new Error('网络超时')
      return {id:'8',mine:false,canReply:false,status:'REPORT_READY',report:{id:'10',ready:true,access:'UNLOCKED',...body}}
    }
  })
  page.onLoad({id:'8'});page.onShow();await flush()
  const content={assessment:'结合患者情况的评估',medicationAdvice:'用药建议',followUpAdvice:'复查建议'}
  for(const [field,value] of Object.entries(content))page.onField({currentTarget:{dataset:{field}},detail:{value}})
  page.onSubmitReport();assert.equal(state.modals.at(-1).title,'确认出具问诊单')
  state.modals.at(-1).success({confirm:true});await flush()
  assert.deepEqual({...page.data.form},content);assert.equal(page.data.saving,false)
  await page.submitReport();assert.equal(keys[0],keys[1]);assert.equal(page.data.doctorView,true)
  assert.equal(page.data.item.canReply,false);assert.equal(page.data.report.assessment,content.assessment)
  assert.equal(page.data.form.assessment,'');await page.submitReport();assert.equal(attempts,2)
  assert.equal(state.keyboardHides,2)
})

test('问诊配图上传完成后才可发布，传递媒体ID而非地址，账号切换不混入旧图片',async()=>{
 let resolve;const {page,state}=harness('consultation-compose',{capabilities:async()=>({submissionEnabled:true}),uploadMediaFile:()=>new Promise(done=>{resolve=done})})
 page.onShow();await flush();page.setData({'form.title':'补充图片的问题','form.symptoms':'这是一段足够长的健康情况测试描述。'})
 const upload=page.onAddImage();await flush();await page.onSubmit();assert.equal(state.publishes.length,0);assert.equal(state.uploads[0][0],9)
 resolve({id:'12'});await upload;await page.onSubmit();assert.deepEqual(Array.from(state.publishes[0].imageMediaIds),['12']);assert.equal(state.publishes[0].images,undefined)
 const other=harness('consultation-compose',{uploadMediaFile:()=>new Promise(done=>{resolve=done})});other.page.onShow();await flush()
 const old=other.page.onAddImage();await flush();other.page.onHide();other.state.token='user-two';other.page.onShow();resolve({id:'99'});await old
 assert.equal(other.page.data.images.length,0);assert.equal(other.page.data.uploading,false)
})

test('医患交流独立于问诊单，5秒增量轮询且离页停止，发送失败重试沿用编号',async()=>{
 let sends=0;const keys=[],queries=[]
 const {page,state}=harness('consultation-chat',{
  detail:async()=>({id:'8',mine:true,detailsVisible:true,status:'IN_PROGRESS',canReply:false,report:{ready:false,access:'LOCKED'}}),
  messages:async(id,q)=>{queries.push(q);return{records:[{id:'1',content:'请补充情况',senderRole:'DOCTOR',mine:false}],canSend:true,hasMore:false}},
  sendMessage:async(id,form)=>{keys.push(form.clientRequestId);if(!sends++)throw new Error('网络超时');return{id:'2',content:form.content,mine:true,senderRole:'PATIENT'}}
 })
 page.onLoad({id:'8'});page.onShow();await flush();assert.equal(page.data.canSend,true);assert.equal(page.data.item.canReply,false)
 assert.equal(state.timers.size,1);const timer=[...state.timers.values()][0];assert.equal(timer.ms,5000);timer.fn();await flush();assert.equal(queries.at(-1).afterId,'1')
 assert.equal(state.reads[0][1],'1')
 page.onInput({detail:{value:'这是我的补充情况'}});await page.onSend();assert.equal(page.data.input,'这是我的补充情况')
 await page.onSend();await flush();assert.equal(keys[0],keys[1]);assert.equal(page.data.messages.length,2)
 assert.equal(page.data.input,'');assert.equal(state.notificationRefreshes,1)
 page.onHide();assert.equal(state.timers.size,0)
})

test('问诊详情只提供独立聊天入口，不读取消息或启动交流轮询',async()=>{
 let reads=0
 const {page,state}=harness('consultation-detail',{detail:async()=>({id:'8',mine:true,detailsVisible:true,status:'IN_PROGRESS'}),messages:async()=>{reads++;return{records:[]}}})
 page.onLoad({id:'8'});page.onShow();await flush();page.onChat()
 assert.equal(reads,0);assert.equal(state.timers.size,0)
 assert.equal(state.navs[0].url,'/pages/consultation-chat/consultation-chat?id=8')
 page.showItem({id:'8',detailsVisible:false,status:'WAITING'});page.onChat();assert.equal(state.navs.length,1)
})

test('问诊聊天渲染后才已读，离页或换账号后的迟到响应不读取新消息',async()=>{
 let release
 const {page,state}=harness('consultation-chat',{
  detail:async()=>({id:'8',detailsVisible:true,status:'IN_PROGRESS'}),
  messages:()=>new Promise(resolve=>{release=resolve})
 })
 page.onLoad({id:'8'});page.onShow();await flush()
 const apply=page.setData.bind(page);let rendered
 page.setData=(data,callback)=>{apply(data);if(callback)rendered=callback}
 release({records:[{id:'7',content:'补充情况',mine:false}],canSend:true,hasMore:false});await flush()
 assert.equal(state.reads.length,0);rendered();await flush();assert.equal(state.reads[0][1],'7')
 const poll=page.loadMessages('after');await flush();page.onHide()
 release({records:[{id:'8',content:'迟到消息',mine:false}],canSend:true,hasMore:false});await poll
 assert.equal(state.reads.length,1);assert.equal(state.timers.size,0);assert.equal(state.keyboardHandlers.size,0)
 state.token='user-two';page.onShow();await flush()
 assert.equal(page.data.messages.length,0);assert.equal(page.data.canSend,false)
})

test('问诊聊天连续拉取增量批次，发送自己的消息不会跳过未拉取的对方消息',async()=>{
 let polling=false;const queries=[]
 const {page}=harness('consultation-chat',{
  detail:async()=>({id:'8',detailsVisible:true,status:'IN_PROGRESS'}),
  messages:async(id,q)=>{
   queries.push({...q})
   if(!polling)return{records:[{id:'1',content:'首条',mine:false}],canSend:true,hasMore:false}
   return String(q.afterId)==='1'?{records:[{id:'2',content:'第二条',mine:false}],canSend:true,hasMore:true}:{records:[{id:'3',content:'第三条',mine:false},{id:'4',content:'自己发送',mine:true}],canSend:true,hasMore:false}
  },
  sendMessage:async()=>({id:'4',content:'自己发送',mine:true})
 })
 page.onLoad({id:'8'});page.onShow();await flush();polling=true
 page.onInput({detail:{value:'自己发送'}});await page.onSend();await flush()
 assert.equal(queries[1].afterId,'1');assert.equal(queries[2].afterId,'2')
 assert.deepEqual(Array.from(page.data.messages,row=>row.id),['1','2','3','4'])
})

test('问诊聊天键盘抬升输入区，Android窗口缩小时不重复减去键盘高度',async()=>{
 const {page}=harness('consultation-chat',{detail:async()=>({id:'8',detailsVisible:true,status:'CLOSED'}),messages:async()=>({records:[],canSend:false,hasMore:false})})
 page.onLoad({id:'8'});page.onShow();await flush()
 page.onFocus({detail:{height:280}});assert.equal(page.data.viewportHeight,420);assert.equal(page.data.keyboardOffset,280)
 page.onResize({size:{windowHeight:420}});assert.equal(page.data.viewportHeight,420);assert.equal(page.data.keyboardOffset,0)
 page.onBlur();page.onFocusKeyboard({detail:{height:0}});page.onResize({size:{windowHeight:700}})
 assert.equal(page.data.viewportHeight,700);assert.equal(page.data.keyboardOffset,0);assert.equal(page.data.canSend,false)
})

test('问诊会话列表只跳转具体聊天，不因查看列表清空未读；旧账号列表不能显示给新账号',async()=>{
 let release
 const {page,state}=harness('consultation-conversations',{conversations:()=>new Promise(resolve=>{release=resolve})})
 page.onShow();await flush();release({records:[{consultationId:'8',unreadCount:2}],pages:1});await flush()
 page.onOpen({currentTarget:{dataset:{id:'8'}}});assert.match(state.navs[0].url,/consultation-chat.*id=8/)
 assert.equal(state.reads.length,0)
 const loading=page.load(false);await flush();page.onHide();state.token='user-two';page.onShow();await flush()
 assert.equal(page.data.records.length,0)
 release({records:[],pages:0});await flush()
 // 上一轮请求仍在途；离页版本守卫独立生效。
 assert.equal(page.data.records.length,0)
})

test('固定输入栏按实际高度为消息留空，离页后的布局回调不会改动页面',async()=>{
 const {page,wx}=harness('consultation-chat',{detail:async()=>({id:'8',detailsVisible:true,status:'IN_PROGRESS'})})
 page.onLoad({id:'8'});page.onShow();await flush()
 wx.createSelectorQuery=()=>({select(){return this},boundingClientRect(){return this},exec(callback){callback([{height:112},{height:480}])}})
 page.measureLayout();assert.equal(page.data.composerHeight,112);assert.equal(page._listHeight,480)
 let finish
 wx.createSelectorQuery=()=>({select(){return this},boundingClientRect(){return this},exec(callback){finish=callback}})
 page.measureLayout();page.onHide();finish([{height:180},{height:300}])
 assert.equal(page.data.composerHeight,112)
})

test('未开放时发布仅提供当前页面预览，不调用发布接口；切换账号清除健康草稿',async()=>{
  const {page,state}=harness('consultation-compose')
  page.onShow();await flush()
  page.setData({'form.title':'最近餐后血糖的问题','form.symptoms':'希望了解最近几天餐后血糖变化的情况。'})
  await page.onSubmit()
  assert.equal(state.publishes.length,0)
  assert.match(state.modals[0].content,/尚未发布/)
  state.modals[0].success({confirm:true})
  assert.equal(state.navs[0].url,'/pages/consultation-detail/consultation-detail?preview=1')
  assert.equal(page.data.form.symptoms.length>0,true)
  page.onHide();state.token='user-two';page.onShow();await flush()
  assert.equal(page.data.form.symptoms,'');assert.equal(page.data.form.anonymous,true)
})

test('预览和未付费问诊单不把医生评估或用药细节放入页面数据，支付入口不创建订单',async()=>{
  const {page,state}=harness('consultation-detail')
  page.onLoad({preview:'1'});page.onShow()
  page.showItem({title:'示例标题',report:{id:'12',access:'UNLOCKED',assessment:'评估正文',medicationAdvice:'用药正文',feeCents:100}})
  assert.equal(page.data.unlocked,false)
  assert.equal(page.data.report.assessment,undefined);assert.equal(page.data.report.medicationAdvice,undefined)
  page.onCheckout();assert.equal(state.orders.length,0)
  assert.match(state.navs[0].url,/preview=1$/)
  const checkout=harness('consultation-checkout');checkout.page.onLoad({preview:'1'})
  checkout.page.onShow();await flush();checkout.page.onPay();assert.equal(checkout.state.orders.length,0)
  assert.match(checkout.state.modals[0].title,/待开放/)
  assert.match(fs.readFileSync(path.join(root,'pages/consultation-checkout/consultation-checkout.wxml'),'utf8'),/disabled="\{\{loading \|\| creating \|\| previewMode/)
})

test('问诊接口统一鉴权，404显示筹备空状态，401和网络错误不伪装成正常数据',async()=>{
  const calls=[],module={exports:{}};let failure=null
  vm.runInNewContext(fs.readFileSync(path.join(root,'services/consultation.js'),'utf8'),{
    module,require:()=>({get:async(...args)=>{calls.push(args);if(failure)throw failure;return{records:[]}},post:async(...args)=>calls.push(args)})
  })
  failure=Object.assign(new Error('missing'),{statusCode:404})
  const caps=await module.exports.capabilities();assert.equal(caps.paymentEnabled,false)
  assert.equal(caps.feeCents,100);assert.equal((await module.exports.list({pageNum:1})).records.length,0)
  failure=Object.assign(new Error('expired'),{code:40100})
  await assert.rejects(module.exports.capabilities(),/expired/)
  failure=Object.assign(new Error('offline'),{network:true})
  await assert.rejects(module.exports.orders(),/offline/)
  failure=null;await module.exports.createOrder({reportId:'12',clientRequestId:'request-01'})
  assert.equal(calls.at(-1)[0],'/consultation-orders')
  assert.equal(calls.at(-1)[2].auth,true)
  assert.equal(calls.at(-1)[1].amount,undefined)
})

test('旧账号的问诊列表迟到响应不能显示给新账号',async()=>{
  const pending=[]
  const {page,state}=harness('consultation',{list:()=>new Promise(resolve=>pending.push(resolve))})
  page.onShow();await flush();assert.equal(state.selected[0],1)
  page.onHide();state.token='user-two';page.onShow();await flush()
  pending[0]({records:[{id:'1',title:'前一账号内容'}],pages:1});await flush()
  assert.equal(page.data.records.length,0)
  pending[1]({records:[],pages:0});await flush();assert.equal(page.data.loading,false)
})

test('隐藏本人求助保留分类和翻页筛选，并记住开关',async()=>{
  const queries=[]
  const {page,state}=harness('consultation',{list:async params=>{queries.push({...params});return{records:[{id:String(queries.length)}],pages:3}}})
  page.onShow();await flush();assert.equal(queries.at(-1).hideMine,false)
  await page.onToggleHideMine();assert.equal(queries.at(-1).hideMine,true);assert.equal(queries.at(-1).pageNum,1)
  assert.equal(state.storage.get('consultationHideMine'),true)
  await page.onReachBottom();assert.equal(queries.at(-1).pageNum,2);assert.equal(queries.at(-1).hideMine,true)
  page.onTopic({currentTarget:{dataset:{code:'DIET'}}});await flush()
  assert.equal(queries.at(-1).topic,'DIET');assert.equal(queries.at(-1).pageNum,1);assert.equal(queries.at(-1).hideMine,true)
  page.onHide();page.setData({hideMine:false});page.onShow();await flush();assert.equal(page.data.hideMine,true)
  await page.onToggleHideMine();assert.equal(queries.at(-1).hideMine,false);assert.equal(state.storage.get('consultationHideMine'),false)
})

test('切换隐藏开关时旧筛选的迟到响应不能覆盖新列表',async()=>{
  const pending=[]
  const {page}=harness('consultation',{list:params=>new Promise(resolve=>pending.push({params,resolve}))})
  page.onShow();await flush();const switching=page.onToggleHideMine();await flush()
  assert.equal(pending[1].params.hideMine,true)
  pending[1].resolve({records:[{id:'20',mine:false}],pages:1});await switching
  pending[0].resolve({records:[{id:'10',mine:true}],pages:1});await flush()
  assert.equal(page.data.records.length,1);assert.equal(page.data.records[0].id,'20');assert.equal(page.data.loading,false)
})

test('认证医生可筛选未接诊，分类、隐藏本人和分页条件保持一致',async()=>{
  const queries=[]
  const {page}=harness('consultation',{doctor:async()=>({status:'APPROVED'}),list:async params=>{
    queries.push({...params});return{records:[{id:String(queries.length)}],pages:3}
  }})
  page.onShow();await flush();assert.equal(page.data.doctorApproved,true)
  await page.onUnclaimedFilter({currentTarget:{dataset:{filter:'unclaimed'}}})
  assert.equal(queries.at(-1).unclaimedOnly,true);assert.equal(queries.at(-1).pageNum,1)
  await page.onReachBottom();assert.equal(queries.at(-1).unclaimedOnly,true);assert.equal(queries.at(-1).pageNum,2)
  await page.onToggleHideMine();assert.equal(queries.at(-1).unclaimedOnly,true);assert.equal(queries.at(-1).hideMine,true)
  page.onTopic({currentTarget:{dataset:{code:'DIET'}}});await flush()
  assert.equal(queries.at(-1).topic,'DIET');assert.equal(queries.at(-1).pageNum,1)
  await page.onUnclaimedFilter({currentTarget:{dataset:{filter:'all'}}});assert.equal(queries.at(-1).unclaimedOnly,false)
})

test('认证失效或切换账号会移除未接诊筛选，普通用户不能开启',async()=>{
  let approved=true;const queries=[]
  const {page,state}=harness('consultation',{doctor:async()=>approved?{status:'APPROVED'}:null,list:async params=>{queries.push({...params});return{records:[],pages:0}}})
  page.onShow();await flush();await page.onUnclaimedFilter({currentTarget:{dataset:{filter:'unclaimed'}}})
  page.onHide();approved=false;page.onShow();await flush()
  assert.equal(page.data.doctorApproved,false);assert.equal(page.data.unclaimedOnly,false);assert.equal(queries.at(-1).unclaimedOnly,false)
  const count=queries.length;await page.onUnclaimedFilter({currentTarget:{dataset:{filter:'unclaimed'}}});assert.equal(queries.length,count)
  approved=true;page.onHide();page.onShow();await flush();await page.onUnclaimedFilter({currentTarget:{dataset:{filter:'unclaimed'}}})
  page.onHide();state.token='another-account';page.onShow();assert.equal(page.data.unclaimedOnly,false)
  await flush();assert.equal(queries.at(-1).unclaimedOnly,false)
})

test('切换未接诊筛选后忽略旧列表，已认证医生返回页面保留筛选',async()=>{
  const pending=[]
  const {page}=harness('consultation',{doctor:async()=>({status:'APPROVED'}),list:params=>new Promise(resolve=>pending.push({params,resolve}))})
  page.onShow();await flush()
  const changing=page.onUnclaimedFilter({currentTarget:{dataset:{filter:'unclaimed'}}});await flush()
  pending[1].resolve({records:[{id:'2',status:'WAITING'}],pages:1});await changing
  pending[0].resolve({records:[{id:'1',status:'IN_PROGRESS'}],pages:1});await flush()
  assert.equal(page.data.records[0].id,'2')
  page.onHide();page.onShow();await flush();assert.equal(pending[2].params.unclaimedOnly,true)
  pending[2].resolve({records:[],pages:0});await flush();assert.equal(page.data.loading,false)
})

test('真实支付使用稳定请求编号，重复点击只发送一次，解锁以服务端为准',async()=>{
  let paid=false, release, sends=0
  const {page,state}=harness('consultation-checkout',{
    capabilities:async()=>({mode:'ACTIVE',paymentEnabled:true,feeCents:100}),
    report:async()=>({id:'5',consultationId:'7',ready:true,feeCents:100,access:paid?'UNLOCKED':'LOCKED'}),
    createOrder:async()=>({orderNo:'CO123'}),
    startPayment:async(no,body)=>{sends++;assert.equal(body.provider,'WALLET_SANDBOX');await new Promise(resolve=>{release=resolve});paid=true;return{status:'PAID'}}
  })
  page.onLoad({reportId:'5'});page.onShow();await flush()
  assert.equal(page.data.ready,true)
  page.onPay();state.modals.at(-1).success({confirm:true});await flush()
  page.onPay();await flush();assert.equal(sends,1)
  release();await flush()
  assert.match(state.navs.at(-1).url,/consultation-detail\?id=7$/)
})

test('扣款失败保留原订单请求编号，不能自行解锁',async()=>{
  const keys=[]
  const {page,state}=harness('consultation-checkout',{
    capabilities:async()=>({mode:'ACTIVE',paymentEnabled:true,feeCents:100}),
    report:async()=>({id:'5',consultationId:'7',ready:true,feeCents:100,access:'LOCKED'}),
    createOrder:async body=>{keys.push(body.clientRequestId);return{orderNo:'CO123'}},
    startPayment:async()=>{throw new Error('沙箱钱包余额不足，请先充值')}
  })
  page.onLoad({reportId:'5'});page.onShow();await flush()
  await page.pay();await page.pay()
  assert.equal(keys[0],keys[1]);assert.equal(state.navs.length,0);assert.equal(page.data.creating,false)
})

test('医生申请仅提交本人资料，旧账号迟到的付款结果不会跳转到新账号',async()=>{
  let release
  const h=harness('consultation-checkout',{
    capabilities:async()=>({mode:'ACTIVE',paymentEnabled:true,feeCents:100}),
    report:async()=>({id:'5',consultationId:'7',ready:true,feeCents:100,access:'LOCKED'}),
    createOrder:async()=>new Promise(resolve=>{release=resolve})
  })
  h.page.onLoad({reportId:'5'});h.page.onShow();await flush();h.page.pay();await flush()
  h.page.onHide();h.state.token='user-two';release({orderNo:'CO123'});await flush()
  assert.equal(h.state.navs.length,0)
  const d=harness('consultation-doctor',{doctor:async()=>null})
  d.page.onShow();await flush();assert.equal(d.page.data.canEdit,true)
  d.page.onField({currentTarget:{dataset:{field:'realName'}},detail:{value:'测试医生'}})
  assert.equal(d.page.data.form.realName,'测试医生')
  d.page.onHide();d.state.token='user-two';d.page.onShow();await flush()
  assert.equal(d.page.data.form.realName,'')
})
