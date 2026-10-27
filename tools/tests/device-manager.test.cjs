const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function setup(){
  let definition,token='account-a',drafts=[{id:'draft-a',sn:'SN-A',name:'我的设备'}]
  const calls={list:[],bind:[],unbind:[],sync:[],toasts:[],modals:[],guide:0,stopped:0}
  const api={fetchMyDevices(){const request=deferred();calls.list.push(request);return request.promise},bindDevice(payload){const request=deferred();calls.bind.push({...request,payload});return request.promise},unbindDevice(id){const request=deferred();calls.unbind.push({...request,id});return request.promise},syncDeviceGlucose(payload){const request=deferred();calls.sync.push({...request,payload});return request.promise},fetchDeviceSyncLogs:async()=>[]}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../pages/devices/devices.js'),'utf8'),{
    Page:value=>definition=value,Date,
    require:name=>({'../../services/device-sim-generator':require('../../services/device-sim-generator'),'../../utils/display':{applyDisplayToCurrentPage(){}},'../../utils/request':{getToken:()=>token},'../../services/api':api,'../../utils/device-drafts':{listDeviceDrafts:()=>drafts.map(d=>({...d})),removeDeviceDraft:(session,id)=>{assert.equal(session,token);drafts=drafts.filter(d=>d.id!==id);return drafts},updateDeviceDraftSn(){},validateSerial(){}}}[name]),
    wx:{showLoading(){},hideLoading(){},showToast:value=>calls.toasts.push(value),showModal:value=>calls.modals.push(value),reLaunch(){},navigateTo(){},stopPullDownRefresh(){calls.stopped++}}
  })
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(value){Object.assign(this.data,value)},getTabBar:()=>({setData(){},refreshGuide(){calls.guide++}})}
  return{page,calls,setToken:value=>token=value}
}
const device={id:'1',deviceSn:'SN-A',deviceName:'我的设备',provider:'HUAWEI',deviceStatus:1,lastSyncAt:''}
const event=id=>({currentTarget:{dataset:{id}}})
test('设备管理刷新真实列表并刷新缓存导航指引，没有同步时间也仍为已绑定',async()=>{
  const {page,calls}=setup();const loading=page.onShow();calls.list[0].resolve([device]);await loading
  assert.equal(calls.guide,1);assert.equal(page.data.boundDevices[0].statusText,'已绑定');assert.equal(page.data.boundDevices[0].syncText,'尚未同步 · 可同步演示读数')
  const refresh=page.onSync(event('1'));assert.equal(calls.sync.length,1);assert.equal(calls.sync[0].payload.provider,'HUAWEI');assert.equal(calls.sync[0].payload.deviceSn,'SN-A')
  calls.sync[0].resolve({createdCount:2});await new Promise(setImmediate);assert.equal(calls.list.length,2);calls.list[1].resolve([device]);await refresh
  assert.equal(calls.toasts.at(-1).title,'同步完成');assert.equal(calls.bind.length,0)
})
test('切换账号后的迟到列表不覆盖设备，隐藏后迟到结果也被忽略',async()=>{
  const {page,calls,setToken}=setup();const first=page.onShow();setToken('account-b');const second=page.onShow()
  calls.list[1].resolve([{...device,id:'2'}]);await second;calls.list[0].resolve([device]);await first
  assert.equal(page.data.boundDevices[0].id,'2');const third=page.refresh();page.onHide();calls.list[2].resolve([device]);await third;assert.equal(page.data.boundDevices[0].id,'2')
})
test('绑定请求只发送一次，失败保留草稿与弹窗，成功后移除本条草稿',async()=>{
  const {page,calls}=setup();const start=page.onShow();calls.list[0].resolve([]);await start;page.onConfirmBind(event('draft-a'))
  const failed=page.onSubmitBind();page.onSubmitBind();page.onCloseBind();assert.equal(calls.bind.length,1);assert.equal(page.data.bindVisible,true)
  calls.bind[0].reject(new Error('序列号已占用'));await failed;assert.equal(page.data.drafts.length,1);assert.equal(page.data.bindVisible,true);assert.equal(page.data.binding,false)
  const succeeded=page.onSubmitBind();calls.bind[1].resolve(device);await new Promise(setImmediate);assert.equal(page.data.drafts.length,0);assert.equal(page.data.boundCount,1);calls.list[1].resolve([device]);await succeeded
})
test('切换账号后绑定回调不能删除新账号草稿或刷新新账号设备',async()=>{
  const {page,calls,setToken}=setup();const start=page.onShow();calls.list[0].resolve([]);await start;page.onConfirmBind(event('draft-a'));const pending=page.onSubmitBind();setToken('account-b');const next=page.onShow();calls.list[1].resolve([]);await next;calls.bind[0].resolve(device);await pending
  assert.equal(page.data.drafts.length,1);assert.equal(page.data.boundCount,0);assert.equal(calls.list.length,2)
})
test('解绑需要确认且迟到确认不会向另一账号发送请求',async()=>{
  const {page,calls,setToken}=setup();const start=page.onShow();calls.list[0].resolve([device]);await start;page.onUnbind(event('1'));setToken('account-b');await calls.modals[0].success({confirm:true});assert.equal(calls.unbind.length,0)
})
test('下拉刷新保持加载直到实际请求完成，失败保留已有设备',async()=>{
  const {page,calls}=setup();const start=page.onShow();calls.list[0].resolve([device]);await start;const refresh=page.onPullDownRefresh();assert.equal(calls.stopped,0);calls.list[1].reject(new Error('网络暂不可用'));await refresh
  assert.equal(calls.stopped,1);assert.equal(page.data.boundDevices.length,1);assert.equal(page.data.loadError,'网络暂不可用')
})
