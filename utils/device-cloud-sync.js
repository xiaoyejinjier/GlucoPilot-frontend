const { getToken } = require('./request')
const { pullDeviceCloud } = require('../services/api')

const STORAGE_KEY = 'lastCloudPullAt'
const THROTTLE_MS = 15 * 60 * 1000

/**
 * 登录后 / App.onShow 静默云拉取：15 分钟本地节流，失败不打断主流程。
 * @param {{ reason?: string, force?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
function tryAutoCloudPull(opts) {
  const options = opts || {}
  const app = typeof getApp === 'function' ? getApp() : null
  if (!app || !app.globalData) return Promise.resolve(null)
  if (!app.globalData.isLoggedIn || !getToken()) return Promise.resolve(null)
  if (app.globalData.disclaimerRequired) return Promise.resolve(null)

  const now = Date.now()
  if (!options.force) {
    const last = Number(wx.getStorageSync(STORAGE_KEY) || 0)
    if (last && now - last < THROTTLE_MS) {
      return Promise.resolve(null)
    }
  }

  return pullDeviceCloud({})
    .then((result) => {
      wx.setStorageSync(STORAGE_KEY, now)
      return result
    })
    .catch((error) => {
      console.warn('[cloud-pull] auto sync failed:', options.reason || '', (error && error.message) || error)
      return null
    })
}

module.exports = {
  tryAutoCloudPull,
  THROTTLE_MS
}
