const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function setup(){
  let definition,token='account-a',drafts=[{id:'draft-a',sn:'SN-A',name:'我的设备'}]
  const calls={list:[],bind:[],unbind:[],sync:[],logs:[],samples:[],toasts:[],modals:[],guide:0,stopped:0}
  const api={
    fetchMyDevices(){const request=deferred();calls.list.push(request);return request.promise},
    bindDevice(payload){const request=deferred();calls.bind.push({...request,payload});return request.promise},
    unbindDevice(id){const request=deferred();calls.unbind.push({...request,id});return request.promise},
    syncDeviceGlucose(payload){const request=deferred();calls.sync.push({...request,payload});return request.promise},
    pullDeviceCloud(){return Promise.resolve({})},
    revokeDeviceCloudAuth(){return Promise.resolve({})},
    createSimDeviceAndSync(){return Promise.resolve({})},
    fetchDeviceSyncLogs(){const request=deferred();calls.logs.push(request);return request.promise},
    fetchDeviceSyncSamples(deviceId,logId){const request=deferred();calls.samples.push({...request,deviceId,logId});return request.promise}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../pages/devices/devices.js'),'utf8'),{
    Page:value=>definition=value,Date,setTimeout,
    require:name=>({
      '../../services/device-sim-generator':require('../../services/device-sim-generator'),
      '../../utils/display':{applyDisplayToCurrentPage(){},getDisplaySettings:()=>({theme:'green'}),getTheme:()=>({brand:'#2770cf'})},
      '../../utils/request':{getToken:()=>token},
      '../../services/api':api,
      '../../utils/device-cloud-sync':{tryAutoCloudPull:async()=>null},
      '../../utils/sync-sample-chart':require('../../utils/sync-sample-chart'),
      '../../utils/device-drafts':{listDeviceDrafts:()=>drafts.map(d=>({...d})),removeDeviceDraft:(session,id)=>{assert.equal(session,token);drafts=drafts.filter(d=>d.id!==id);return drafts},updateDeviceDraftSn(){},validateSerial(){}}
    }[name]),
    wx:{
      showLoading(){},hideLoading(){},showToast:value=>calls.toasts.push(value),showModal:value=>calls.modals.push(value),
      reLaunch(){},navigateTo(){},stopPullDownRefresh(){calls.stopped++}
    }
  })
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(value){Object.assign(this.data,value)},getTabBar:()=>({setData(){},refreshGuide(){calls.guide++}})}
  return{page,calls,setToken:value=>token=value}
}
const device={id:'1',deviceSn:'SN-A',deviceName:'我的设备',provider:'HUAWEI',deviceStatus:1,lastSyncAt:''}
const event=id=>({currentTarget:{dataset:{id}}})
test('设备管理从我的进入仍刷新真实列表且不更改导航选中项，没有同步时间也仍为已绑定',async()=>{
  const {page,calls}=setup();const loading=page.onShow();calls.list[0].resolve([device]);await loading
  assert.equal(calls.guide,0);assert.equal(page.data.boundDevices[0].statusText,'已绑定');assert.equal(page.data.boundDevices[0].syncText,'未授权云 · 可先授权或演示同步')
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
test('展开同步记录后默认加载最近一次样本统计',async()=>{
  const {page,calls}=setup();const start=page.onShow();calls.list[0].resolve([device]);await start
  page.onDetail(event('1'));page.onToggleSyncLogs()
  assert.equal(calls.logs.length,1)
  calls.logs[0].resolve([{id:'9',provider:'MOCK',sampleCount:2,createdCount:2,syncedAt:'2026-11-24T10:00:00'}])
  await new Promise(setImmediate)
  assert.equal(calls.samples.length,1)
  assert.equal(calls.samples[0].logId,'9')
  calls.samples[0].resolve({syncedAt:'2026-11-24T10:00:00',sampleCount:2,points:[{recordedAt:'2026-11-24T08:00:00',glucoseValue:5.6},{recordedAt:'2026-11-24T09:00:00',glucoseValue:7.2}]})
  await new Promise(setImmediate)
  assert.equal(page.data.selectedSyncLogId,'9')
  assert.equal(page.data.syncSampleStats.count,2)
  assert.equal(page.data.syncSampleStats.maxText,'7.2')
  assert.equal(page.data.syncSampleChart.points.length,2)
  assert.equal(page.data.syncSampleChart.points[0].valueText,'5.6')
  assert.equal(page.data.syncSampleChart.segments.length,1)
  assert.equal(page.data.syncSampleChart.unit,'mmol/L')
})
