const { applyDisplayToCurrentPage, saveDisplaySettings } = require('./utils/display')
const { getUserInfo, saveUserInfo } = require('./utils/storage')
const { getToken } = require('./utils/request')
const { fetchMe } = require('./services/api')
const { fontNameOf, themeIdOf } = require('./utils/mappers')

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
      this.syncProfile()
    } else {
      wx.setStorageSync('isLoggedIn', false)
      this.globalData.isLoggedIn = false
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  /** 登录态下用服务端资料与偏好校准本地缓存（含字号/主题）。 */
  syncProfile() {
    fetchMe()
      .then((userInfo) => {
        saveUserInfo(userInfo)
        this.globalData.userInfo = userInfo
        saveDisplaySettings({
          fontSize: fontNameOf(userInfo.fontSize),
          theme: themeIdOf(userInfo.themeCode)
        })
        applyDisplayToCurrentPage()
      })
      .catch(() => null)
  },

  checkLogin() {
    if (!this.globalData.isLoggedIn || !getToken()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  }
})
