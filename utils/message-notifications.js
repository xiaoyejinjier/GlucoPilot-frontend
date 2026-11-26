const api = require('../services/api')
const { getToken } = require('./request')
const realtime = require('./message-realtime')
let timer = null, token = '', epoch = 0, busy = false, latest = '', latestNotice = '', latestReport = '', latestConsultation = '', latestDoctorReview = '', enabled = false
let promptedConsultations = new Set()
function doctorReviewNotice(value) {
  if (!value || !/^(0|[1-9]\d{0,18})$/.test(String(value.version))) return null
  const labels = {
    APPROVED: ['医生认证已通过', '可以前往医生工作台接诊。'],
    REJECTED: ['医生认证未通过', '请前往医生工作台查看审核意见。'],
    DISABLED: ['医生资格已停用', '请前往医生工作台查看当前状态。']
  }
  const text = Object.prototype.hasOwnProperty.call(labels,value.status) ? labels[value.status] : null
  return text ? { version:String(value.version), status:value.status, title:text[0], description:text[1] } : null
}
function consultationConversations(value) {
  const rows = Array.isArray(value) ? value : [], byId = new Map()
  for (const row of rows) {
    const id = String(row && row.consultationId || '')
    if (!/^[1-9]\d{0,18}$/.test(id) || !count(row.unreadCount)) continue
    const previous = byId.get(id)
    if (!previous || compareId(row.lastMessageId, previous.lastMessageId) > 0) byId.set(id, { ...row, consultationId:id, unreadCount:count(row.unreadCount) })
  }
  return [...byId.values()].sort((a,b) => compareId(b.lastMessageId, a.lastMessageId))
}
function compareId(first, second) { const a=String(first||''),b=String(second||'');return a.length-b.length||(a<b?-1:a>b?1:0) }
function count(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0,Math.floor(number)) : 0 }
function label(value) { const n = count(value); return n > 99 ? '99+' : n ? String(n) : '' }
function currentApp(owner) { return owner || (typeof getApp === 'function' ? getApp() : null) }
function publish(value, owner) {
  const source = value && typeof value === 'object' ? value : { messages:value }
  const counts = Object.fromEntries(['messages','likes','collections','comments','follows','reports','consultations','doctorReviews'].map(key => [key,count(source[key])]))
  counts.doctorReview = counts.doctorReviews > 0 ? doctorReviewNotice(source.doctorReview) : null
  counts.doctorReviews = counts.doctorReview ? 1 : 0
  counts.total = ['messages','likes','collections','comments','follows','reports','consultations','doctorReviews'].reduce((sum,key) => sum+counts[key],0)
  counts.consultationConversations = consultationConversations(source.consultationConversations)
  const n = counts.total, app = currentApp(owner)
  if (app && app.globalData) {
    app.globalData.unreadCount = n
    app.globalData.informationCounts = counts
  }
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  if (!page) return
  const reading = page.route === 'pages/consultation-chat/consultation-chat' ? String(page._id || '') : ''
  const consultationNotice = counts.consultationConversations.find(row => row.consultationId !== reading) || null
  page.setData({ unreadCount:n, unreadLabel:label(n), informationCounts:counts })
  const tab = typeof page.getTabBar === 'function' && page.getTabBar()
  if (tab) tab.setData({ unreadCount:n, consultationUnread:counts.consultations+counts.doctorReviews,
    consultationNotice, doctorReviewNotice:counts.doctorReview })
}
async function refresh(force = false) {
  if (!getToken()) { reset(); return }
  if (!enabled) return
  // 明确的已读操作使旧汇总失效，避免旧请求把红点重新加回来。
  if (force === true) { epoch++; busy = false }
  if (busy) return
  if (token !== getToken()) { stop(); start(); return }
  busy = true
  const version = epoch, requestedToken = token
  try {
    const state = await (api.fetchInformationSummary ? api.fetchInformationSummary() : api.fetchUnreadMessages())
    if (!enabled || epoch !== version || getToken() !== requestedToken) return
    publish(state.total == null ? {messages:state.unreadCount} : state)
    const id = String(state.latestMessageId || '')
    const pages = getCurrentPages(), page = pages[pages.length - 1]
    const review = count(state.doctorReviews) > 0 ? doctorReviewNotice(state.doctorReview) : null
    if (review && `${review.status}:${review.version}` !== latestDoctorReview) {
      latestDoctorReview = `${review.status}:${review.version}`
      const tab = page && typeof page.getTabBar === 'function' && page.getTabBar()
      const profile = page && page.data && page.data.profile
      const readingReview = page && page.route === 'pages/consultation-doctor/consultation-doctor'
        && profile && String(profile.version) === review.version && profile.status === review.status
      if (!tab && !readingReview)
        wx.showToast({title:`${review.title}，可前往医生工作台查看`,icon:'none',duration:3500})
    }
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
      if (!newer && (!page || page.route !== 'pages/information/information')) wx.showToast({title:'有新的互动提醒，可在社区对应入口查看',icon:'none',duration:2500})
    }
    const reportId=String(state.latestReportId||'')
    const reportNew=reportId&&(!latestReport||reportId.length>latestReport.length||(reportId.length===latestReport.length&&reportId>latestReport))
    if(reportNew){
      latestReport=reportId
      if(count(state.reports)>0&&(!page||page.route!=='pages/community-reports/community-reports'))wx.showToast({title:'举报有了处理反馈，可在我的举报查看',icon:'none',duration:2500})
    }
    const threads = consultationConversations(state.consultationConversations)
    if (Array.isArray(state.consultationConversations)) {
      const unreadIds = new Set(threads.map(row => row.consultationId))
      promptedConsultations = new Set([...promptedConsultations].filter(id => unreadIds.has(id)))
      const fresh = threads.find(row => !promptedConsultations.has(row.consultationId) && !(page && page.route === 'pages/consultation-chat/consultation-chat' && String(page._id) === row.consultationId))
      const tab = page && typeof page.getTabBar === 'function' && page.getTabBar()
      if (fresh && !tab) wx.showToast({title:'收到新的问诊消息，可在问诊消息中查看',icon:'none',duration:3500})
      // 同一未读会话只提示一次；连续消息更新原会话的数量。
      for (const row of threads) promptedConsultations.add(row.consultationId)
    } else {
      const consultationId = String(state.latestConsultationMessageId || '')
      if (consultationId && compareId(consultationId, latestConsultation) > 0) {
        latestConsultation = consultationId
        if (count(state.consultations) > 0 && (!page || page.route !== 'pages/consultation-chat/consultation-chat')) wx.showToast({ title:'收到新的问诊消息，可在问诊消息中查看',icon:'none',duration:3500 })
      }
    }
  } catch (_) { /* Quiet polling never blocks navigation or reveals message content. */ }
  finally { if (epoch === version) busy = false }
}
function start() {
  const current = getToken()
  if (!current) { stop(); return }
  if (enabled && token === current) {
    realtime.start()
    const app = currentApp()
    if (app && app.globalData) publish(app.globalData.informationCounts || app.globalData.unreadCount, app)
    return
  }
  if (token !== current) { latest = latestNotice = latestReport = latestConsultation = latestDoctorReview = ''; promptedConsultations = new Set(); publish(0) }
  stop(); token = current; enabled = true; refresh()
  realtime.start()
  timer = setInterval(refresh,5000)
}
function stop() {
  realtime.stop()
  if (timer) clearInterval(timer)
  timer = null; epoch++; busy = false; enabled = false
  // Keep the high-water mark across a background/foreground cycle of this account.
}
function reset(owner) { stop(); token = ''; latest = latestNotice = latestReport = latestConsultation = latestDoctorReview = ''; promptedConsultations = new Set(); publish(0, owner) }
module.exports = { start, stop, reset, refresh, count, label, consultationConversations, doctorReviewNotice }

// WebSocket及时唤醒未读汇总；其他类型通知仍由原汇总轮询负责。
realtime.subscribe(event => {
  if (enabled && (event.type === 'CONNECTED' || event.type === 'DM_CHANGED')) refresh(true)
})
