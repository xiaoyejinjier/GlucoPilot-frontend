const { fetchMe, fetchGlucoseSummary, logoutRemote, fetchMyDevices, fetchDeviceSyncLogs } = require('../../services/api')
const { getUserInfo, saveUserInfo, logout } = require('../../utils/storage')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')

const app = getApp()
const PROVIDER_NAMES = {
  MOCK: '测试设备',
  HUAWEI: '华为健康',
  HEALTH_CONNECT: 'Health Connect',
  APPLE_HEALTH: '苹果健康',
  NIGHTSCOUT: 'Nightscout'
}

function parseSyncTime(value) {
  if (!value) return 0
  const time = Date.parse(String(value).replace(' ', 'T'))
  return Number.isFinite(time) ? time : 0
}

function formatSyncAt(value) {
  if (!value) return ''
  return String(value).replace('T', ' ').slice(0, 19)
}

function emptyDeviceCover() {
  return {
    boundCount: 0,
    hasSync: false,
    deviceName: '',
    providerName: '',
    syncedAt: '',
    syncTitle: '暂无同步记录',
    syncDetail: '绑定设备后，最新一次同步会显示在这里'
  }
}

Page({
  data: {
    displayStyle: '',
    userInfo: {},
    todayCount: '0/9',
    avgGlucose: '--',
    streakDays: 0,
    loggingOut: false,
    deviceCover: emptyDeviceCover()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._mineVisible=true;this._mineEpoch=(this._mineEpoch||0)+1
    this.setData({loggingOut:!!this._logoutInFlight})
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 2 })
      if (typeof tabBar.refreshGuide === 'function') tabBar.refreshGuide()
    }
    applyDisplayToCurrentPage()
    if(!this._logoutPending)this.refresh()
  },
  onHide(){this._mineVisible=false;this._mineEpoch=(this._mineEpoch||0)+1},
  onUnload(){this.onHide()},
  sessionActive(token,epoch){return this._mineVisible&&!!token&&token===getToken()&&epoch===this._mineEpoch&&!this.data.loggingOut},

  refresh() {
    const token=getToken(),epoch=this._mineEpoch
    if(!this.sessionActive(token,epoch))return
    // 先用缓存渲染，避免白屏；接口返回后覆盖
    const cached = getUserInfo()
    if (cached) {
      this.setData({ userInfo: cached })
    }

    fetchMe()
      .then((userInfo) => {
        if(!this.sessionActive(token,epoch))return
        saveUserInfo(userInfo)
        app.globalData.userInfo = userInfo
        this.setData({ userInfo })
      })
      .catch((err) => {
        if(!this.sessionActive(token,epoch))return
        wx.showToast({ title: err.message || '资料加载失败', icon: 'none' })
      })

    fetchGlucoseSummary({})
      .then((summary) => {
        if(!this.sessionActive(token,epoch))return
        this.setData({
          todayCount: `${summary.todayCount}/${summary.totalNodes}`,
          avgGlucose: summary.todayAvg == null ? '--' : String(summary.todayAvg),
          streakDays: summary.streakDays
        })
      })
      .catch(() => {
        if(!this.sessionActive(token,epoch))return
        this.setData({ todayCount: '0/9', avgGlucose: '--', streakDays: 0 })
      })

    this.loadDeviceCover(token, epoch)
  },

  async loadDeviceCover(token, epoch) {
    try {
      const devices = await fetchMyDevices()
      if (!this.sessionActive(token, epoch)) return
      const list = Array.isArray(devices) ? devices : []
      const boundCount = list.length
      if (!boundCount) {
        this.setData({ deviceCover: emptyDeviceCover() })
        return
      }
      let latest = list[0]
      let latestTs = parseSyncTime(latest && latest.lastSyncAt)
      list.forEach((device) => {
        const ts = parseSyncTime(device.lastSyncAt)
        if (ts > latestTs) {
          latest = device
          latestTs = ts
        }
      })
      const providerName = PROVIDER_NAMES[latest.provider] || latest.provider || '设备'
      const deviceName = latest.deviceName || '我的血糖仪'
      let syncedAt = formatSyncAt(latest.lastSyncAt)
      let syncDetail = syncedAt ? `${providerName} · ${deviceName}` : '已绑定设备，尚未同步'
      let syncTitle = syncedAt ? `最新同步 ${syncedAt}` : '暂无同步记录'
      try {
        const logs = await fetchDeviceSyncLogs(latest.id, 1)
        if (!this.sessionActive(token, epoch)) return
        const row = Array.isArray(logs) && logs[0]
        if (row) {
          syncedAt = formatSyncAt(row.syncedAt) || syncedAt
          const samples = Number(row.sampleCount) || 0
          const created = Number(row.createdCount) || 0
          syncTitle = syncedAt ? `最新同步 ${syncedAt}` : syncTitle
          syncDetail = `${providerName} · ${deviceName} · 采样 ${samples} · 新写入 ${created}`
        }
      } catch (_) { /* 列表时间足够作为封面兜底 */ }
      if (!this.sessionActive(token, epoch)) return
      this.setData({
        deviceCover: {
          boundCount,
          hasSync: !!syncedAt,
          deviceName,
          providerName,
          syncedAt,
          syncTitle,
          syncDetail
        }
      })
    } catch (_) {
      if (!this.sessionActive(token, epoch)) return
      this.setData({ deviceCover: emptyDeviceCover() })
    }
  },

  onMenuTap(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },

  onDevicesTap() {
    if (!this.sessionActive(getToken(), this._mineEpoch)) return
    wx.navigateTo({ url: '/pages/devices/devices' })
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  },
  onPublicProfile(){const key=this.data.userInfo.communityKey;if(this.sessionActive(getToken(),this._mineEpoch)&&/^u[1-9]\d{0,18}$/.test(String(key||'')))wx.navigateTo({url:`/pages/community-profile/community-profile?key=${key}`})},

  onCopyCommunityKey() {
    const key = this.data.userInfo.communityKey
    if (/^u[1-9]\d{0,18}$/.test(String(key || ''))) wx.setClipboardData({ data: key })
  },
  onLogout(){
    if(this._logoutPending||!this._mineVisible||!getToken())return
    const token=getToken(),epoch=this._mineEpoch;this._logoutPending=true
    wx.showModal({title:'退出登录',content:'确定要退出当前账号吗？',success:result=>{
      if(!result.confirm||!this.sessionActive(token,epoch)){this._logoutPending=false;return}
      this._logoutInFlight=true;this._mineEpoch++;this.setData({loggingOut:true})
      wx.showLoading({title:'退出中…',mask:true})
      Promise.resolve().then(()=>{if(getToken()===token)return logoutRemote()}).catch(()=>{}).then(()=>{
        this._logoutInFlight=false;this._logoutPending=false
        const current=getToken()
        if(current&&current!==token){if(this._mineVisible)this.setData({loggingOut:false});return}
        wx.hideLoading();app.resetLoginState();logout();this._mineEpoch++
        this.setData({userInfo:{},todayCount:'0/9',avgGlucose:'--',streakDays:0,unreadCount:0,unreadLabel:'',deviceCover:emptyDeviceCover(),loggingOut:false})
        wx.reLaunch({url:'/pages/login/login'})
      })
    },fail:()=>{this._logoutPending=false}})
  }
})
