Page({
  onNav(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
