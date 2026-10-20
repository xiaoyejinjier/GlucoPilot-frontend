const { fetchMe, fetchGlucoseSummary, logoutRemote } = require('../../services/api')
const { getUserInfo, saveUserInfo, logout } = require('../../utils/storage')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')

const app = getApp()

Page({
  data: {
    displayStyle: '',
    userInfo: {},
    todayCount: '0/9',
    avgGlucose: '--',
    streakDays: 0,
    loggingOut:false
  },

  onShow() {
    if (!app.checkLogin()) return
    this._mineVisible=true;this._mineEpoch=(this._mineEpoch||0)+1
    this.setData({loggingOut:!!this._logoutInFlight})
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 3 })
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
  },

  onMenuTap(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  },

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
        this.setData({userInfo:{},todayCount:'0/9',avgGlucose:'--',streakDays:0,unreadCount:0,unreadLabel:'',loggingOut:false})
        wx.reLaunch({url:'/pages/login/login'})
      })
    },fail:()=>{this._logoutPending=false}})
  }
})
