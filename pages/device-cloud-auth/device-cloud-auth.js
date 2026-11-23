const { fetchHuaweiAuthorizeUrl } = require('../../services/api')

Page({
  data: {
    loading: true,
    error: '',
    authorizeUrl: '',
    done: false,
    doneMessage: '',
    deviceId: ''
  },

  onLoad(query) {
    const deviceId = query && query.deviceId ? String(query.deviceId) : ''
    const cloudAuth = query && query.cloudAuth != null ? String(query.cloudAuth) : ''
    this.setData({ deviceId })
    if (cloudAuth === '1') {
      this.setData({
        loading: false,
        done: true,
        doneMessage: '华为健康授权成功，可返回设备页进行云同步。'
      })
      return
    }
    if (cloudAuth === '0') {
      const message = query && query.message
        ? decodeURIComponent(String(query.message))
        : '授权未完成'
      this.setData({ loading: false, error: message })
      return
    }
    this.loadAuthorizeUrl()
  },

  onRetry() {
    this.setData({ error: '', loading: true, authorizeUrl: '', done: false })
    this.loadAuthorizeUrl()
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/devices/devices' }) })
  },

  async loadAuthorizeUrl() {
    try {
      const result = await fetchHuaweiAuthorizeUrl(this.data.deviceId || undefined)
      if (!result.authorizeUrl) {
        this.setData({ loading: false, error: '未获取到授权地址，请确认云同步已启用' })
        return
      }
      this.setData({ loading: false, authorizeUrl: result.authorizeUrl })
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && error.message) || '无法开始授权'
      })
    }
  }
})
