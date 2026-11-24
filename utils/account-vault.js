const config = require('./config')

const STORAGE_KEY = 'savedAccountSessionsV1'
const MAX_ACCOUNTS = 5
const ID_RE = /^u[1-9]\d{0,18}$/

function scope() { return String(config.baseUrl || '').replace(/\/+$/, '') }
function read() {
  try {
    const data = wx.getStorageSync(STORAGE_KEY)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch (_) { return {} }
}
function entries() {
  const rows = read()[scope()]
  return Array.isArray(rows) ? rows.filter(row => row && ID_RE.test(row.id)).slice(0, MAX_ACCOUNTS) : []
}
function write(rows) {
  const key = scope()
  if (!key) return
  const data = read()
  data[key] = rows.slice(0, MAX_ACCOUNTS)
  try { wx.setStorageSync(STORAGE_KEY, data); return true }
  catch (_) { try { wx.removeStorageSync(STORAGE_KEY) } catch (_) {} return false }
}
function remember(info, token, doctorStatus, options) {
  const id = String(info && info.communityKey || '')
  if (!ID_RE.test(id) || typeof token !== 'string' || !token || !scope()) return
  const rows = entries(), old = rows.find(row => row.id === id)
  // 普通资料刷新只更新已保存的同一会话；新增账号或保存新令牌必须来自主动添加/重新验证。
  if (!(options && options.explicit) && (!old || old.token !== token)) return
  const role = doctorStatus === undefined ? (old && old.role || 'UNKNOWN')
    : doctorStatus === 'APPROVED' ? 'DOCTOR' : 'USER'
  const phone = /^1\d{10}$/.test(String(info.phone || '')) ? String(info.phone) : ''
  const row = { id, token, role, nickname: String(info.nickname || '').slice(0, 64),
    avatarText: String(info.avatarText || info.nickname || '友').slice(0, 2),
    phone, phoneMasked: phone ? phone.slice(0, 3) + '****' + phone.slice(-4) : String(info.phoneMasked || ''),
    lastUsedAt: old && old.token === token ? old.lastUsedAt : Date.now(),
    saveSource: options && options.explicit ? 'ACCOUNT_SWITCH' : old && old.saveSource || 'LEGACY' }
  const next = [row].concat(rows.filter(value => value.id !== id)).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  write(next)
}
function session(id) { return entries().find(row => row.id === String(id)) || null }
function invalidateToken(token) {
  if (!token) return
  const rows = entries()
  if (rows.some(row => row.token === token)) write(rows.map(row => row.token === token ? { ...row, token: '' } : row))
}
function remove(id) { write(entries().filter(row => row.id !== String(id))) }
function touch(id) { write(entries().map(row => row.id === id ? { ...row, lastUsedAt: Date.now() } : row).sort((a, b) => b.lastUsedAt - a.lastUsedAt)) }
function list(currentToken) {
  // 令牌只保留在模块内部，公开展示对象不能进入页面data。
  return entries().map(row => ({ id: row.id, nickname: row.nickname || '糖友', avatarText: row.avatarText,
    phoneMasked: row.phoneMasked, role: row.role,
    roleLabel: row.role === 'DOCTOR' ? '医生账号' : row.role === 'USER' ? '普通账号' : '身份待确认',
    current: !!currentToken && row.token === currentToken, requiresLogin: !row.token }))
}
module.exports = { scope, remember, session, invalidateToken, remove, touch, list, MAX_ACCOUNTS }
