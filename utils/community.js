const { getToken } = require('./request')

function requestId() { return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}` }
function timeLabel(value) { return value ? String(value).replace('T', ' ').slice(0, 16) : '' }
function relativeTime(value, now = Date.now()) {
  if (!value) return ''
  let text = String(value).trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text += '+08:00'
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`
  return `${Math.floor(minutes / 1440)}天前`
}
function begin(page) {
  page._communityToken = getToken()
  page._communityVersion = (page._communityVersion || 0) + 1
  page._communityVisible = true
}
function active(page, version = page._communityVersion, error) {
  const token = getToken()
  const ownExpired = error && error.code === 40100 && !token
  return page._communityVisible && !!page._communityToken && (page._communityToken === token || ownExpired) && version === page._communityVersion
}
function end(page) { page._communityVisible = false; page._communityVersion = (page._communityVersion || 0) + 1 }
function failure(page, error, version = page._communityVersion) {
  if (!active(page, version, error)) return
  if (error && error.code === 40100) {
    getApp().resetLoginState()
    wx.reLaunch({ url: '/pages/login/login' })
    return
  }
  wx.showToast({ title: (error && error.message) || '操作失败，请重试', icon: 'none' })
}
function success(page, kind, enabled = true) {
  if (!active(page)) return
  const labels = { liked: enabled ? '点赞成功' : '已取消点赞', collected: enabled ? '收藏成功' : '已取消收藏',
    followed: enabled ? '关注成功' : '取消关注成功', comment: '评论成功', reply: '回复成功' }
  const feedback = typeof page.selectComponent === 'function' && page.selectComponent('#social-feedback')
  if (labels[kind] && feedback && typeof feedback.show === 'function') feedback.show(labels[kind])
}
function compareId(a, b) { const x = String(a.id), y = String(b.id); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0) }
function report(type, id) {
  if (['ARTICLE','COMMENT','USER','MESSAGE'].includes(type) && /^[1-9]\d{0,18}$/.test(String(id || '')))
    wx.navigateTo({ url: `/pages/community-report/community-report?type=${type}&id=${id}` })
}
function mergeMessages(existing, incoming) {
  const map = new Map(existing.map(message => [String(message.id), message]))
  incoming.forEach(message => map.set(String(message.id), { ...message, timeLabel: timeLabel(message.createdAt) }))
  return Array.from(map.values()).sort(compareId)
}
module.exports = { requestId, timeLabel, relativeTime, begin, active, end, failure, success, compareId, mergeMessages, report }
