const { fetchMe, fetchGlucoseRecords, fetchGlucoseSummary } = require('../../services/api')
const { getUserInfo, saveUserInfo, getTodayKey } = require('../../utils/storage')

Page({
  data: {
    userInfo: {},
    todayRecords: '暂无记录',
    yesterdayRecords: '暂无记录',
    weekCompliance: '--',
    weekSummary: '暂无足够数据生成小结'
  },

  onLoad() {
    const cached = getUserInfo()
    if (cached) {
      this.setData({ userInfo: cached })
    }
    fetchMe()
      .then((userInfo) => {
        saveUserInfo(userInfo)
        this.setData({ userInfo })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '资料加载失败', icon: 'none' })
      })

    this.loadRecords()
  },

  loadRecords() {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 24 * 3600 * 1000)
    const fmt = (d) => getTodayKey(d)

    fetchGlucoseRecords({ startDate: fmt(today), endDate: fmt(today), pageSize: 100 })
      .then((page) => this.setData({ todayRecords: this.joinValues(page.records) }))
      .catch(() => this.setData({ todayRecords: '暂无记录' }))

    fetchGlucoseRecords({ startDate: fmt(yesterday), endDate: fmt(yesterday), pageSize: 100 })
      .then((page) => this.setData({ yesterdayRecords: this.joinValues(page.records) }))
      .catch(() => this.setData({ yesterdayRecords: '暂无记录' }))

    fetchGlucoseSummary({})
      .then((summary) => {
        this.setData({
          weekCompliance: `${summary.compliance}%`,
          weekSummary: this.buildSummary(summary)
        })
      })
      .catch(() => null)
  },

  joinValues(records) {
    const list = (records || []).map((r) => r.value)
    return list.length ? list.join(' / ') : '暂无记录'
  },

  buildSummary(summary) {
    if (summary.monthAvg == null) {
      return '本月暂无血糖记录，去 AI 页完成九时段记录后即可生成小结。'
    }
    const parts = [`本月平均血糖 ${summary.monthAvg} mmol/L`]
    if (summary.monthMax != null && summary.monthMin != null) {
      parts.push(`波动区间 ${summary.monthMin}~${summary.monthMax}`)
    }
    parts.push(`已打卡 ${summary.monthRecordDays} 天`)
    return `${parts.join('，')}。`
  }
})
