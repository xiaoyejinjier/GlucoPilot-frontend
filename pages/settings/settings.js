const { logout } = require('../../utils/storage')
const { logoutRemote, syncMockGlucose } = require('../../services/api')
const { setToken } = require('../../utils/request')
const app = getApp()

Page({
  onNav(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },

  onSyncDevice() {
    wx.showLoading({ title: '同步中...', mask: true })
    syncMockGlucose()
      .then((res) => {
        wx.hideLoading()
        const n = (res && res.items && res.items.length) || 0
        wx.showToast({ title: `已同步 ${n} 条`, icon: 'success' })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '同步失败', icon: 'none' })
      })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '退出中...', mask: true })
        logoutRemote()
          .finally(() => {
            wx.hideLoading()
            setToken('')
            logout()
            app.globalData.isLoggedIn = false
            app.globalData.userInfo = null
            wx.reLaunch({ url: '/pages/login/login' })
          })
      }
    })
  }
})
