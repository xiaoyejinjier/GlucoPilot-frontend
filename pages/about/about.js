Page({
  data: {
    version: '1.0.0'
  },

  onCheckUpdate() {
    wx.showModal({
      title: '检查更新',
      content: '当前已是最新版本 v' + this.data.version,
      showCancel: false
    })
  }
})
