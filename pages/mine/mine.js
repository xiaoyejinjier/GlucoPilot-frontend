const { fetchMe, fetchGlucoseSummary } = require('../../services/api')
const { getUserInfo, saveUserInfo } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')

const app = getApp()

Page({
  data: {
    displayStyle: '',
    userInfo: {},
    todayCount: '0/9',
    avgGlucose: '--',
    streakDays: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    applyDisplayToCurrentPage()
    this.refresh()
  },

  refresh() {
    // 先用缓存渲染，避免白屏；接口返回后覆盖
    const cached = getUserInfo()
    if (cached) {
      this.setData({ userInfo: cached })
    }

    fetchMe()
      .then((userInfo) => {
        saveUserInfo(userInfo)
        app.globalData.userInfo = userInfo
        this.setData({ userInfo })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '资料加载失败', icon: 'none' })
      })

    fetchGlucoseSummary({})
      .then((summary) => {
        this.setData({
          todayCount: `${summary.todayCount}/${summary.totalNodes}`,
          avgGlucose: summary.todayAvg == null ? '--' : String(summary.todayAvg),
          streakDays: summary.streakDays
        })
      })
      .catch(() => {
        this.setData({ todayCount: '0/9', avgGlucose: '--', streakDays: 0 })
      })
  },

  onMenuTap(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  }
})
