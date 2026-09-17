Page({
  data: {
    recordDays: 0,
    lastBackup: ''
  },

  onShow() {
    const all = wx.getStorageSync('glucoseRecords') || {}
    const lastBackup = wx.getStorageSync('lastBackupAt') || ''
    this.setData({
      recordDays: Object.keys(all).length,
      lastBackup
    })
  },

  onBackup() {
    const payload = {
      userInfo: wx.getStorageSync('userInfo') || {},
      glucoseRecords: wx.getStorageSync('glucoseRecords') || {},
      at: this.formatNow()
    }
    wx.setStorageSync('dataBackup', payload)
    wx.setStorageSync('lastBackupAt', payload.at)
    this.setData({ lastBackup: payload.at })
    wx.showToast({ title: '备份完成', icon: 'success' })
  },

  onRestore() {
    const backup = wx.getStorageSync('dataBackup')
    if (!backup) {
      wx.showToast({ title: '暂无备份可恢复', icon: 'none' })
      return
    }
    wx.showModal({
      title: '恢复备份',
      content: `将恢复 ${backup.at} 的数据，是否继续？`,
      success: (res) => {
        if (!res.confirm) return
        if (backup.userInfo) wx.setStorageSync('userInfo', backup.userInfo)
        if (backup.glucoseRecords) wx.setStorageSync('glucoseRecords', backup.glucoseRecords)
        wx.showToast({ title: '已恢复', icon: 'success' })
      }
    })
  },

  formatNow() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
})
