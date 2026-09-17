const { getUserInfo, getRecords } = require('../../utils/storage')

Page({
  data: {
    userInfo: {},
    todayRecords: ''
  },

  onLoad() {
    const userInfo = getUserInfo()
    const records = getRecords()
    const values = Object.values(records)
      .filter(r => r.value != null)
      .map(r => r.value)
      .join(' / ')
    this.setData({ userInfo, todayRecords: values || '暂无记录' })
  }
})
