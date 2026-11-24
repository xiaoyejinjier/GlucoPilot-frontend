const config = require('./config')
const { getUserInfo } = require('./storage')
const { resolveTopic } = require('./tag-images')
const DEFAULT_CODES = ['GLUCOSE', 'DIET', 'MEDICATION', 'CHECKUP', 'FASTING', 'POST_MEAL', 'HYPOGLYCEMIA', 'CGM']

// 仅存分类编码，按当前接口环境和账号隔离，不保存令牌。
function scope() {
  const user = getUserInfo() || {}
  return /^u[1-9]\d*$/.test(user.communityKey || '')
    ? `consultationTopics:v1:${config.baseUrl}:${user.communityKey}` : ''
}
function read(catalog) {
  let codes = DEFAULT_CODES
  const key = scope()
  try {
    const saved = key && wx.getStorageSync(key)
    if (Array.isArray(saved) && saved.every(code => typeof code === 'string')) codes = saved
  } catch (_) {}
  return [...new Set(codes)].map(code => catalog.find(item => item.code === code)).filter(Boolean)
}
function save(codes) {
  const key = scope()
  if (!key) return
  wx.setStorageSync(key, [...new Set(codes)].filter(code => /^[A-Z][A-Z0-9_]{0,15}$/.test(code)).slice(0, 60))
}
function reset(catalog) { save(DEFAULT_CODES); return read(catalog) }
function normalize(rows) {
  const seen = new Set()
  return (Array.isArray(rows) ? rows : []).filter(item => {
    if (!item || !/^[A-Z][A-Z0-9_]{0,15}$/.test(item.code) || !item.name || seen.has(item.code)) return false
    seen.add(item.code); return true
  }).map(item => ({ code: item.code, name: String(item.name), groupName: item.groupName || '健康管理', icon: resolveTopic(item) }))
}
module.exports = { read, save, reset, normalize, scope }
