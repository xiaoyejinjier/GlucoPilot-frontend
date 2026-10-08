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
  const { url, method = 'GET', data, auth = true, header = {} } = options
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
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401 || body.code === 40100) {
          setToken('')
          wx.setStorageSync('isLoggedIn', false)
          reject(Object.assign(new Error(body.message || '未登录或 Token 失效'), { code: 40100, body }))
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
        reject(Object.assign(new Error(err.errMsg || '网络异常'), { network: true, err }))
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
