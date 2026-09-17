const { applyDisplayToCurrentPage } = require('./utils/display')
const { getUserInfo } = require('./utils/storage')
const { getToken } = require('./utils/request')

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    /** 拍照页传给确认页的临时图，避免 URL 传路径导致黑屏 */
    pendingShotImage: ''
  },

  onLaunch() {
    const loggedIn = wx.getStorageSync('isLoggedIn')
    const token = getToken()
    if (loggedIn && token) {
      this.globalData.isLoggedIn = true
      this.globalData.userInfo = getUserInfo()
    } else {
      wx.setStorageSync('isLoggedIn', false)
      this.globalData.isLoggedIn = false
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  checkLogin() {
    if (!this.globalData.isLoggedIn || !getToken()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  }
})
