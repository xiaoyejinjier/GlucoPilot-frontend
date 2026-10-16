/**
 * 唯一的 C 端 API 配置入口。
 *
 * 页面、service 和 request 不得自行拼服务器地址。开发者工具默认访问本机后端；
 * 模拟器及真机开发/调试可读取设备 Storage 中的临时地址；正式发布使用生产域名。
 */

/** 正式发布前替换为已在微信公众平台登记的 HTTPS 域名。 */
const PROD_BASE_URL = 'https://api.example.com/api/v1'

/** 微信开发者工具模拟器运行在电脑本机（与后端 application.yaml 的 server.port=8080 一致）。 */
const DEVTOOLS_BASE_URL = 'http://127.0.0.1:8080/api/v1'

/**
 * 取运行环境的 platform。
 *
 * <h2>为什么不能只用 wx.getSystemInfoSync（2026-10-16 的事故）</h2>
 * 基础库 3.17+ 已弃用 {@code wx.getSystemInfoSync}，控制台会打
 * 「wx.getSystemInfoSync is deprecated. Please use wx.getDeviceInfo/...」。
 * 一旦该 API 在新基础库下被移除或抛错，{@link isDevtools} 会**静默**变成 false ——
 * 小程序以为自己跑在真机上，于是回落到占位生产域名、请求在发出去之前就被拦下，
 * <b>后端一条日志都看不到</b>（用户报的就是"检查后端没有发现登录请求"）。
 * 因此：优先用新 API，旧 API 只作兜底，两者都拿不到时把 platform 值记下来，
 * 让"为什么用了生产地址"变成可查的事实，而不是靠猜。
 *
 * @returns {string} platform（如 devtools / windows / mac / android / ios），拿不到时返回空串
 */
function devicePlatform() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo() || {}
      if (info.platform) return String(info.platform)
    }
  } catch (e) {
    // 继续走兜底：新 API 存在但调用失败时，至少还能试旧 API
  }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync() || {}
      if (info.platform) return String(info.platform)
    }
  } catch (e) {
    // 两个都拿不到：返回空串，由调用方按"不认识环境"处理并告警
  }
  return ''
}

function isDevtools() {
  return /devtools/i.test(devicePlatform())
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
 * 把用户填的地址规整成 {@code http(s)://host[:port][/path]/api/v1}。
 * <p>
 * 宽容处理：允许只填 {@code 192.168.1.5:8080}（自动补 http:// 与 /api/v1）、
 * 也允许带结尾斜杠。**不合法时返回空串，由调用方打日志**——静默忽略一个填错的地址
 * 正是"配了却没生效"这类悬案的最大来源。
 */
function normalizeBaseUrl(raw) {
  const input = String(raw == null ? '' : raw).trim()
  if (!input) return ''
  // 明确的非法形态先挡掉，再谈"宽容补全"：
  // 带凭据(user:pass@)、查询串、hash、内嵌 scheme（ftp:// 等）都是配置事故的常见来源，
  // 补全逻辑会把它们拼成"看起来合法"的地址，反而更难查。
  if (/[@?#\s]/.test(input)) return ''
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) return ''
  let url = input.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  if (!/\/api\/v1$/i.test(url)) url += '/api/v1'
  const host = '(?:\\[[a-f\\d:]+\\]|[a-z\\d.-]+)'
  const valid = new RegExp('^https?:\\/\\/' + host + '(?::\\d{1,5})?(?:\\/[a-z\\d._~-]+)*\\/api\\/v1$', 'i')
  if (!valid.test(url)) return ''
  // 历史占位值不算有效配置，否则它会一直遮住真正的开发地址
  if (/^https:\/\/api\.example\.com(?:\/|$)/i.test(url)) return ''
  return url
}

/**
 * 真机/联调地址只保存在开发设备 Storage，不进入仓库；正式版始终忽略。
 */
function developmentOverride() {
  if (envVersion() === 'release') return ''
  try {
    const raw = wx.getStorageSync('apiBaseUrl')
    if (!raw) return ''
    const normalized = normalizeBaseUrl(raw)
    if (!normalized) {
      console.warn('[config] 已忽略无效的 apiBaseUrl：' + raw
        + '（应形如 http://192.168.1.5:8080/api/v1，接口路径必须是 /api/v1）')
      return ''
    }
    return normalized
  } catch (e) {
    return ''
  }
}

function canConfigureDevelopment() {
  return envVersion() !== 'release'
}

/**
 * 当前使用的后端地址，以及它是怎么来的（排障用：日志/报错里都能看到）。
 * @returns {{url: string, source: string}}
 */
function resolveBaseUrl() {
  const override = developmentOverride()
  if (override) return { url: override, source: 'storage:apiBaseUrl' }
  if (isDevtools()) return { url: DEVTOOLS_BASE_URL, source: 'devtools-default' }
  if (envVersion() === 'release') return { url: PROD_BASE_URL, source: 'production' }
  // 开发/体验版但认不出是开发者工具（platform 拿不到、或 PC 微信小程序）：
  // 仍然给本机地址 + 明确告警。**不静默回落到占位生产域名**——那个域名永远不可能通，
  // 只会把"地址没配对"表现成"点了没反应"，是这次事故里最难查的一环。
  console.warn('[config] 未能识别运行环境（platform=' + (devicePlatform() || 'unknown')
    + '），按开发环境使用 ' + DEVTOOLS_BASE_URL + '；若在真机/PC 微信上请设置 apiBaseUrl')
  return { url: DEVTOOLS_BASE_URL, source: 'dev-fallback' }
}

function currentBaseUrl() {
  return resolveBaseUrl().url
}

function connectionIssue() {
  const resolved = resolveBaseUrl()
  const url = resolved.url
  if (/^https?:\/\/api\.example\.com(?:\/|$)/i.test(url)) {
    return '服务地址尚未配置，请联系管理员'
  }
  if (!isDevtools() && /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(url)) {
    // 保留"服务地址未就绪"的判定语义（这是 2026-10-15 定下的：真机没配地址时**不发请求**，
    // 让用户看到明确提示而不是等一个必然失败的连接），同时把"怎么配"写进同一句话——
    // 只说"请联系管理员"会让开发者多绕一大圈。
    return '服务地址尚未配置：真机不能用本机地址，请在调试基础库执行 '
      + 'wx.setStorageSync(\'apiBaseUrl\', \'http://电脑局域网IP:8080/api/v1\')'
  }
  return ''
}

function saveDevelopmentBaseUrl(input) {
  if (!canConfigureDevelopment()) throw new Error('正式版不能修改后端地址')
  const url = normalizeBaseUrl(input)
  if (!url) {
    throw new Error('请填写后端 HTTP 或 HTTPS 地址，接口路径为 /api/v1（例如 http://192.168.1.5:8080）')
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
  /** 提供给日志/排障：当前地址与它来自哪里（storage / devtools 默认 / 开发兜底 / 生产） */
  resolveBaseUrl,
  devicePlatform,
  envVersion,
  /** 便于诊断脚本复用 */
  normalizeBaseUrl,
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}
