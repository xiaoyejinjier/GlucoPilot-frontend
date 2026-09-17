const { getUserInfo, getRecords, getAllRecords } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { GLUCOSE_NODES } = require('../../utils/constants')

Page({
  data: {
    displayStyle: '',
    userInfo: {},
    todayCount: '0/9',
    avgGlucose: '--',
    streakDays: 1
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
    applyDisplayToCurrentPage()
    this.refresh()
  },

  refresh() {
    const userInfo = getUserInfo()
    const day = getRecords() || {}
    const values = []
    Object.keys(day).forEach(id => {
      const rec = day[id]
      if (rec && rec.value != null && !isNaN(Number(rec.value))) {
        values.push(Number(rec.value))
      }
    })
    const avg = values.length
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
      : '--'

    let streak = 0
    const all = getAllRecords()
    const cursor = new Date()
    for (let i = 0; i < 30; i++) {
      const p = n => (n < 10 ? '0' + n : '' + n)
      const key = `${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`
      const recs = all[key] || {}
      if (Object.keys(recs).length > 0) {
        streak += 1
        cursor.setDate(cursor.getDate() - 1)
      } else if (i === 0 && Object.keys(day).length > 0) {
        streak = 1
        break
      } else {
        break
      }
    }

    this.setData({
      userInfo,
      todayCount: `${Object.keys(day).length}/${GLUCOSE_NODES.length}`,
      avgGlucose: avg,
      streakDays: streak || 1
    })
  },

  onMenuTap(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })
  }
})
