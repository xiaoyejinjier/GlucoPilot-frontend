/**
 * 唯一的 C 端 API 配置入口。
 *
 * 页面、service 和 request 不得自行拼服务器地址。开发者工具固定访问本机后端；
 * 真机开发/调试可读取开发者工具 Storage 中的临时地址；正式发布使用生产域名。
 */

/** 正式发布前替换为已在微信公众平台登记的 HTTPS 域名。 */
const PROD_BASE_URL = 'https://api.example.com/api/v1'

/** 微信开发者工具模拟器运行在电脑本机。 */
const DEVTOOLS_BASE_URL = 'http://127.0.0.1:8080/api/v1'

function isDevtools() {
  try {
    return (wx.getSystemInfoSync() || {}).platform === 'devtools'
  } catch (e) {
    return false
  }
}

function envVersion() {
  try {
    const info = wx.getAccountInfoSync()
    return info && info.miniProgram && info.miniProgram.envVersion
      ? info.miniProgram.envVersion
      : 'release'
  } catch (e) {
    return 'release'
  }
}

/**
 * 真机联调地址只保存在开发设备 Storage，不进入仓库。
 * 配好真实生产域名后，正式版会忽略该临时覆盖。
 */
function developmentOverride() {
  try {
    const value = String(wx.getStorageSync('apiBaseUrl') || '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+(?::\d+)?\/api\/v1$/i.test(value)) return ''
    // 清理/忽略历史占位值，防止它继续覆盖正确的开发配置。
    if (/^https:\/\/api\.example\.com(?:\/|$)/i.test(value)) return ''
    const productionConfigured = !/^https:\/\/api\.example\.com(?:\/|$)/i.test(PROD_BASE_URL)
    if (envVersion() === 'release' && productionConfigured) return ''
    return value
  } catch (e) {
    return ''
  }
}

const devtools = isDevtools()
const baseUrl = devtools
  ? DEVTOOLS_BASE_URL
  : (developmentOverride() || PROD_BASE_URL)

module.exports = {
  baseUrl,
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}
