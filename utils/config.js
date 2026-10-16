/**
 * 唯一的 C 端 API 配置入口。
 *
 * 页面、service 和 request 不得自行拼服务器地址。开发者工具默认访问本机后端；
 * 模拟器及真机开发/调试可读取设备 Storage 中的临时地址；正式发布使用生产域名。
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
 * 正式版始终忽略该临时覆盖。
 */
function developmentOverride() {
  try {
    const value = String(wx.getStorageSync('apiBaseUrl') || '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/?#]+(?:\/[^\s/?#]+)*\/api\/v1$/i.test(value)) return ''
    // 清理/忽略历史占位值，防止它继续覆盖正确的开发配置。
    if (/^https:\/\/api\.example\.com(?:\/|$)/i.test(value)) return ''
    if (envVersion() === 'release') return ''
    return value
  } catch (e) {
    return ''
  }
}

function canConfigureDevelopment() {
  return envVersion() !== 'release'
}

function currentBaseUrl() {
  return developmentOverride() || (isDevtools() ? DEVTOOLS_BASE_URL : PROD_BASE_URL)
}

function connectionIssue() {
  const url = currentBaseUrl()
  if (/^https?:\/\/api\.example\.com(?:\/|$)/i.test(url)) {
    return '服务地址尚未配置，请联系管理员'
  }
  if (!isDevtools() && /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(url)) {
    return '手机不能使用本机地址，请填写电脑的局域网地址'
  }
  return ''
}

function saveDevelopmentBaseUrl(input) {
  if (!canConfigureDevelopment()) throw new Error('正式版不能修改后端地址')
  let url = String(input || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\/(?:\[[a-f\d:]+\]|[a-z\d.-]+)(?::\d{1,5})?$/i.test(url)) url += '/api/v1'
  if (!/^https?:\/\/(?:\[[a-f\d:]+\]|[a-z\d.-]+)(?::\d{1,5})?(?:\/[a-z\d._~-]+)*\/api\/v1$/i.test(url)
      || /^https?:\/\/api\.example\.com(?:\/|$)/i.test(url)) {
    throw new Error('请填写后端 HTTP 或 HTTPS 地址，接口路径为 /api/v1')
  }
  if (!isDevtools() && /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(url)) {
    throw new Error('真机请使用电脑的局域网地址，不能填 localhost')
  }
  wx.setStorageSync('apiBaseUrl', url)
  return url
}

module.exports = {
  get baseUrl() { return currentBaseUrl() },
  canConfigureDevelopment,
  connectionIssue,
  saveDevelopmentBaseUrl,
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}
