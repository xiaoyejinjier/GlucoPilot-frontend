const config = require('./config')

const TOKEN_KEY = 'accessToken'

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

function setToken(token) {
  if (token) {
    wx.setStorageSync(TOKEN_KEY, token)
  } else {
    wx.removeStorageSync(TOKEN_KEY)
  }
}

/**
 * 统一请求。成功约定：HTTP 2xx 且 body.code === 0，返回 data。
 */
function request(options) {
  const { url, method = 'GET', data, auth = true, header = {}, timeout } = options
  const issue = !url.startsWith('http') && typeof config.connectionIssue === 'function' ? config.connectionIssue() : ''
  if (issue) return Promise.reject(Object.assign(new Error(issue), { configuration: true }))
  const headers = {
    'Content-Type': 'application/json',
    ...header
  }
  if (auth) {
    const token = getToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: url.startsWith('http') ? url : `${config.baseUrl}${url}`,
      method,
      data,
      header: headers,
      ...(timeout ? { timeout } : {}),
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401 || body.code === 40100) {
          if (auth) {
            setToken('')
            wx.setStorageSync('isLoggedIn', false)
          }
          const message = auth
            ? (body.message || '未登录或 Token 失效')
            : '登录服务暂不可用，请稍后重试'
          reject(Object.assign(new Error(message), {
            code: 40100,
            body,
            requestId: body.requestId || ''
          }))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
          return
        }
        const msg = body.message || `请求失败(${res.statusCode})`
        reject(Object.assign(new Error(msg), { code: body.code, body, statusCode: res.statusCode }))
      },
      fail(err) {
        const detail = (err && err.errMsg) || ''
        const base = typeof config.baseUrl === 'string' ? config.baseUrl : ''
        // 报错里带上"实际打到了哪个地址"：这次登录事故（请求根本没发出/发错端口）就是
        // 因为错误信息里没有任何地址线索，只能靠人肉翻配置才定位到。
        const message = /timeout/i.test(detail) ? `连接超时：${base}`
          : /not in domain list|url not in domain|不在.*域名/i.test(detail) ? `请求域名未允许（${base}），请检查真机调试设置`
            : `无法连接后端（${base}），请确认服务已启动、地址与端口正确`
        reject(Object.assign(new Error(message), { network: true, err, baseUrl: base }))
      }
    })
  })
}

function get(url, data, options = {}) {
  return request({ url, method: 'GET', data, ...options })
}

function post(url, data, options = {}) {
  return request({ url, method: 'POST', data, ...options })
}

function put(url, data, options = {}) {
  return request({ url, method: 'PUT', data, ...options })
}

function patch(url, data, options = {}) {
  return request({ url, method: 'PATCH', data, ...options })
}

function del(url, data, options = {}) {
  return request({ url, method: 'DELETE', data, ...options })
}

module.exports = {
  request,
  get,
  post,
  put,
  patch,
  del,
  getToken,
  setToken,
  TOKEN_KEY
}
