const api = require('../services/api')
const { getToken } = require('./request')
let timer = null, token = '', epoch = 0, busy = false, latest = '', latestNotice = '', latestReport = '', enabled = false
function count(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0,Math.floor(number)) : 0 }
function label(value) { const n = count(value); return n > 99 ? '99+' : n ? String(n) : '' }
function publish(value) {
  const source = value && typeof value === 'object' ? value : { messages:value }
  const counts = Object.fromEntries(['messages','likes','collections','comments','follows','reports'].map(key => [key,count(source[key])]))
  counts.total = Object.values(counts).reduce((sum,n) => sum+n,0)
  const n = counts.total, app = getApp()
  app.globalData.unreadCount = n
  app.globalData.informationCounts = counts
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  if (!page) return
  page.setData({ unreadCount:n, unreadLabel:label(n), informationCounts:counts })
  const tab = typeof page.getTabBar === 'function' && page.getTabBar()
  if (tab) tab.setData({ unreadCount:n })
}
async function refresh() {
  if (!getToken()) { reset(); return }
  if (!enabled || busy) return
  if (token !== getToken()) { stop(); start(); return }
  busy = true
  const version = epoch, requestedToken = token
  try {
    const state = await (api.fetchInformationSummary ? api.fetchInformationSummary() : api.fetchUnreadMessages())
    if (!enabled || epoch !== version || getToken() !== requestedToken) return
    publish(state.total == null ? {messages:state.unreadCount} : state)
    const id = String(state.latestMessageId || '')
    const pages = getCurrentPages(), page = pages[pages.length - 1]
    const reading = page && page.route === 'pages/messages/messages' && page._peer === String(state.latestSenderId)
    // MAX(id) can decrease when a conversation is read: only higher IDs are new.
    const newer = id && (!latest || id.length > latest.length || (id.length === latest.length && id > latest))
    if (newer) {
      latest = id
      if (!reading && count(state.messages == null ? state.unreadCount : state.messages) > 0) wx.showToast({ title:'收到新私信，可在信息中查看', icon:'none', duration:2500 })
    }
    const noticeId = String(state.latestNotificationId || '')
    if (noticeId && (!latestNotice || noticeId.length > latestNotice.length || (noticeId.length === latestNotice.length && noticeId > latestNotice))) {
      latestNotice = noticeId
      if (!newer && (!page || page.route !== 'pages/information/information')) wx.showToast({title:'有新的互动提醒，可在信息中查看',icon:'none',duration:2500})
    }
    const reportId=String(state.latestReportId||'')
    const reportNew=reportId&&(!latestReport||reportId.length>latestReport.length||(reportId.length===latestReport.length&&reportId>latestReport))
    if(reportNew){
      latestReport=reportId
      if(count(state.reports)>0&&(!page||page.route!=='pages/community-reports/community-reports'))wx.showToast({title:'举报有了处理反馈，可在我的举报查看',icon:'none',duration:2500})
    }
  } catch (_) { /* Quiet polling never blocks navigation or reveals message content. */ }
  finally { if (epoch === version) busy = false }
}
function start() {
  const current = getToken()
  if (!current) { stop(); return }
  if (enabled && token === current) { publish(getApp().globalData.informationCounts || getApp().globalData.unreadCount); return }
  if (token !== current) { latest = latestNotice = latestReport = ''; publish(0) }
  stop(); token = current; enabled = true; refresh()
  timer = setInterval(refresh,5000)
}
function stop() {
  if (timer) clearInterval(timer)
  timer = null; epoch++; busy = false; enabled = false
  // Keep the high-water mark across a background/foreground cycle of this account.
}
function reset() { stop(); token = ''; latest = latestNotice = latestReport = ''; publish(0) }
module.exports = { start, stop, reset, refresh, count, label }
