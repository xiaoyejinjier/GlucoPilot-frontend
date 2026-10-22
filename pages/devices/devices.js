const { applyDisplayToCurrentPage } = require('../../utils/display')
const { listDeviceDrafts, removeDeviceDraft, updateDeviceDraftSn, validateSerial } = require('../../utils/device-drafts')
const { fetchMyDevices, bindDevice, unbindDevice } = require('../../services/api')
const { getToken } = require('../../utils/request')
const PROVIDERS = [
  {code:'MOCK',name:'测试设备'}, {code:'HUAWEI',name:'华为健康'},
  {code:'HEALTH_CONNECT',name:'Health Connect'}, {code:'APPLE_HEALTH',name:'苹果健康'},
  {code:'NIGHTSCOUT',name:'Nightscout'}
]
function parseTime(value) {
  if (!value) return null
  const time=Date.parse(String(value).replace(' ','T'))
  return Number.isFinite(time)?time:null
}
function enrichDevice(device) {
  const enabled=Number(device.deviceStatus)===1
  const lastSyncDisplay=device.lastSyncAt?String(device.lastSyncAt).replace('T',' ').slice(0,19):'暂无同步记录'
  return {...device,id:String(device.id),online:enabled,statusText:enabled?'已绑定':'已停用',
    providerName:PROVIDERS.find(p=>p.code===device.provider)?.name||'其他设备',
    syncActionText:'刷新状态',syncText:device.lastSyncAt?'最近同步：'+lastSyncDisplay:'尚未同步',lastSyncDisplay}
}
function computeLastSyncLabel(devices) {
  const times=devices.map(d=>parseTime(d.lastSyncAt)).filter(t=>t!=null)
  if (!times.length) return '—'
  const diff=Math.max(0,Date.now()-Math.max(...times))
  if (diff<60000) return '刚刚'
  if (diff<3600000) return Math.floor(diff/60000)+'分钟'
  if (diff<86400000) return Math.floor(diff/3600000)+'小时'
  return Math.floor(diff/86400000)+'天'
}
Page({
  data:{displayStyle:'',loading:false,loadError:'',boundDevices:[],boundCount:0,drafts:[],lastSyncLabel:'—',providers:PROVIDERS,
    detailVisible:false,detail:{},snVisible:false,snDraftId:'',snInput:'',snError:'',bindVisible:false,bindDraft:{},bindProvider:'HUAWEI',bindName:'',binding:false,unbinding:false},
  onShow() {
    this._active=true
    const tab=typeof this.getTabBar==='function'&&this.getTabBar()
    if(tab){tab.setData({selected:1});if(typeof tab.refreshGuide==='function')tab.refreshGuide()}
    applyDisplayToCurrentPage()
    const token=getToken()
    if(this._token!==token)this.setData({boundDevices:[],boundCount:0,drafts:[],lastSyncLabel:'—',detailVisible:false,detail:{},snVisible:false,snInput:'',snDraftId:'',bindVisible:false,bindDraft:{},binding:false,unbinding:false})
    this._token=token
    if(!token){wx.reLaunch({url:'/pages/login/login'});return}
    return this.refresh()
  },
  onHide(){this.invalidate()},onUnload(){this.invalidate()},
  invalidate(){this._active=false;this._run=(this._run||0)+1;this._lifecycle=(this._lifecycle||0)+1;this.setData({loading:false,binding:false,unbinding:false,bindVisible:false,snVisible:false,detailVisible:false})},
  current(token=this._token,lifecycle=this._lifecycle){return this._active&&!!token&&getToken()===token&&this._token===token&&lifecycle===this._lifecycle},
  applyList(boundDevices,drafts){this.setData({boundDevices,boundCount:boundDevices.length,drafts,lastSyncLabel:computeLastSyncLabel(boundDevices)})},
  async refresh() {
    if(!this.current())return false
    const token=this._token,lifecycle=this._lifecycle,run=this._run=(this._run||0)+1
    this.setData({loading:true,loadError:'',drafts:listDeviceDrafts(token)})
    try{
      const list=await fetchMyDevices()
      if(!this.current(token,lifecycle)||run!==this._run)return false
      this.applyList((list||[]).map(enrichDevice),listDeviceDrafts(token))
      return true
    }catch(error){if(this.current(token,lifecycle)&&run===this._run)this.setData({loadError:error.message||'设备加载失败，请重试'});return false}
    finally{if(this.current(token,lifecycle)&&run===this._run)this.setData({loading:false})}
  },
  onAddDevice(){if(this.current())wx.navigateTo({url:'/pages/device-add/device-add'})},
  async onSync(event){if(!this.current()||this.data.loading)return;const id=String(event.currentTarget.dataset.id);if(!this.data.boundDevices.some(d=>d.id===id))return;const token=this._token,lifecycle=this._lifecycle;if(await this.refresh())if(this.current(token,lifecycle))wx.showToast({title:'状态已更新',icon:'none'})},
  onDetail(event){if(!this.current())return;const device=this.data.boundDevices.find(d=>d.id===String(event.currentTarget.dataset.id));if(device)this.setData({detailVisible:true,detail:device})},
  onCloseDetail(){this.setData({detailVisible:false})},
  onUnbind(event){
    if(!this.current()||this.data.unbinding)return
    const device=this.data.boundDevices.find(d=>d.id===String(event.currentTarget.dataset.id));if(!device)return
    const token=this._token,lifecycle=this._lifecycle
    wx.showModal({title:'解绑设备',content:'确定解绑「'+device.deviceName+'」？已有测量记录会保留。',confirmText:'解绑',
      success:async result=>{
        if(!result.confirm||!this.current(token,lifecycle)||this.data.unbinding)return
        this.setData({unbinding:true})
        try{await unbindDevice(device.id);if(!this.current(token,lifecycle))return;this.applyList(this.data.boundDevices.filter(d=>d.id!==device.id),this.data.drafts);wx.showToast({title:'已解绑',icon:'success'});await this.refresh()}
        catch(error){if(this.current(token,lifecycle))wx.showToast({title:error.message||'解绑失败',icon:'none'})}
        finally{if(this.current(token,lifecycle))this.setData({unbinding:false})}
      }})
  },
  onRemoveDraft(event){if(this.current()&&!this.data.binding)this.applyList(this.data.boundDevices,removeDeviceDraft(this._token,event.currentTarget.dataset.id))},
  onSupplementSn(event){if(!this.current())return;const draft=this.data.drafts.find(d=>d.id===event.currentTarget.dataset.id);if(draft)this.setData({snVisible:true,snDraftId:draft.id,snInput:draft.sn||'',snError:''})},
  onCloseSn(){this.setData({snVisible:false,snDraftId:'',snInput:'',snError:''})},
  onSnInput(event){this.setData({snInput:event.detail.value,snError:''})},
  onSaveSn(){if(!this.current())return;try{validateSerial(this.data.snInput);const drafts=updateDeviceDraftSn(this._token,this.data.snDraftId,this.data.snInput);this.onCloseSn();this.applyList(this.data.boundDevices,drafts);wx.showToast({title:'已补充 SN',icon:'success'})}catch(error){this.setData({snError:error.message||'SN 无效'})}},
  onConfirmBind(event){
    if(!this.current()||this.data.binding)return
    const draft=this.data.drafts.find(d=>d.id===event.currentTarget.dataset.id)
    if(!draft||!draft.sn){wx.showToast({title:'请先补充 SN',icon:'none'});return}
    this.setData({bindVisible:true,bindDraft:draft,bindProvider:'HUAWEI',bindName:draft.name||''})
  },
  onCloseBind(){if(!this.data.binding)this.setData({bindVisible:false})},
  onBindNameInput(event){if(!this.data.binding)this.setData({bindName:event.detail.value})},
  onPickProvider(event){const code=event.currentTarget.dataset.provider;if(!this.data.binding&&PROVIDERS.some(p=>p.code===code))this.setData({bindProvider:code})},
  async onSubmitBind(){
    if(!this.current()||!this.data.bindVisible||this.data.binding)return
    const draft=this.data.bindDraft,token=this._token,lifecycle=this._lifecycle
    if(!draft||!draft.sn)return
    this.setData({binding:true})
    try{
      const result=await bindDevice({deviceSn:draft.sn,provider:this.data.bindProvider,deviceName:this.data.bindName})
      if(!this.current(token,lifecycle))return
      const drafts=removeDeviceDraft(token,draft.id),item=enrichDevice(result)
      this.applyList([item,...this.data.boundDevices.filter(d=>d.id!==item.id)],drafts)
      this.setData({bindVisible:false,bindDraft:{}})
      wx.showToast({title:'绑定成功',icon:'success'})
      await this.refresh()
    }catch(error){if(this.current(token,lifecycle))wx.showToast({title:error.message||'绑定失败',icon:'none'})}
    finally{if(this.current(token,lifecycle))this.setData({binding:false})}
  },
  noop(){},
  async onPullDownRefresh(){try{await this.refresh()}finally{wx.stopPullDownRefresh()}}
})
