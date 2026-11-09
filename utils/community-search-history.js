const { getUserInfo } = require('./storage')

const MAX = 20

function storageKey() {
  const info = getUserInfo()
  const id = info && (info.communityKey || info.userId || info.id)
  if (!id) return 'community:search:history:guest'
  return `community:search:history:${String(id)}`
}

function normalize(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80)
}

function list() {
  try {
    const raw = wx.getStorageSync(storageKey())
    if (!Array.isArray(raw)) return []
    return raw
      .map(normalize)
      .filter(Boolean)
      .slice(0, MAX)
  } catch (_) {
    return []
  }
}

function push(keyword) {
  const text = normalize(keyword)
  if (!text) return list()
  const next = [text, ...list().filter(item => item.toLowerCase() !== text.toLowerCase())].slice(0, MAX)
  try {
    wx.setStorageSync(storageKey(), next)
  } catch (_) {}
  return next
}

function clear() {
  try {
    wx.removeStorageSync(storageKey())
  } catch (_) {}
  return []
}

module.exports = { list, push, clear, normalize }
