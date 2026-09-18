const { get, post, put, del, setToken } = require('../utils/request')
const { openSse } = require('../utils/sse')

const CHANNEL_NAMES = ['', '企业动态', '行业快讯', '设备新知', '控糖科普']

function channelName(code) {
  return CHANNEL_NAMES[code] || '资讯'
}

function channelCode(name) {
  const idx = CHANNEL_NAMES.indexOf(name)
  return idx > 0 ? idx : null
}

function formatTime(iso) {
  if (!iso) return ''
  const s = String(iso).replace('T', ' ')
  return s.length >= 16 ? s.slice(0, 16) : s
}

function mapNewsItem(n) {
  const type = n.contentType === 2 ? 'video' : 'article'
  return {
    id: n.id,
    title: n.title,
    summary: n.summaryText || '',
    channel: channelName(n.channelCode),
    channelCode: n.channelCode,
    type,
    typeLabel: type === 'video' ? '视频' : '图文',
    time: formatTime(n.publishAt),
    cover: n.coverUrl || '/assets/news/n1.jpg',
    coverText: type === 'video' ? '▶' : '资讯',
    videoUrl: n.videoUrl || '',
    contentBody: n.contentBody || '',
    likeCount: n.likeCount || 0,
    collectCount: n.collectCount || 0,
    liked: !!n.liked,
    collected: !!n.collected
  }
}

function mapBanner(b) {
  return {
    id: b.id,
    title: b.title,
    desc: b.subtitle || '',
    imageUrl: b.imageUrl || '',
    linkUrl: b.linkUrl || ''
  }
}

function mapFood(f, categoryName) {
  return {
    id: f.id,
    name: f.foodName,
    category: categoryName || '',
    categoryCode: f.categoryCode,
    carbs: f.carbsPer100g,
    cal: f.caloriesPer100g,
    image: f.imageUrl || '/assets/foods/rice.jpg'
  }
}

/** ---------- auth ---------- */
function wechatLogin(code) {
  return post('/auth/wechat/sessions', { code }, { auth: false }).then((data) => {
    setToken(data.accessToken)
    wx.setStorageSync('isLoggedIn', true)
    return data
  })
}

function sendSmsCode(phone, scene) {
  return post('/auth/sms/codes', { phone, scene: scene || 'login' }, { auth: false })
}

function phoneLogin(phone, smsCode) {
  return post('/auth/phone/sessions', { phone, smsCode }, { auth: false }).then((data) => {
    setToken(data.accessToken)
    wx.setStorageSync('isLoggedIn', true)
    return data
  })
}

function logoutRemote() {
  return del('/auth/sessions/current', null, { auth: true }).catch(() => null)
}

/** ---------- content ---------- */
function fetchBanners() {
  return get('/banners', null, { auth: false }).then((list) => (list || []).map(mapBanner))
}

function fetchNews(channelNameOrCode, pageNum, pageSize) {
  const data = { pageNum: pageNum || 1, pageSize: pageSize || 20 }
  const code = typeof channelNameOrCode === 'number'
    ? channelNameOrCode
    : channelCode(channelNameOrCode)
  if (code) data.channelCode = code
  return get('/news', data, { auth: false }).then((page) => ({
    ...page,
    records: (page && page.records ? page.records : []).map(mapNewsItem)
  }))
}

function fetchNewsDetail(id) {
  return get(`/news/${id}`, null, { auth: !!wx.getStorageSync('accessToken') })
    .then(mapNewsItem)
}

function updateNewsAction(id, payload) {
  return put(`/news/${id}/actions`, payload, { auth: true })
}

function fetchFoodCategories() {
  return get('/food-categories', null, { auth: false }).then((list) => list || [])
}

function fetchFoods(params) {
  const data = {
    pageNum: (params && params.pageNum) || 1,
    pageSize: (params && params.pageSize) || 50
  }
  if (params && params.categoryCode) data.categoryCode = params.categoryCode
  if (params && params.keyword) data.keyword = params.keyword
  return get('/foods', data, { auth: false }).then((page) => {
    const records = (page && page.records ? page.records : []).map((f) => mapFood(f))
    return { ...page, records }
  })
}

/** ---------- chat（接口文档 2.23 / 2.24 / 2.25） ---------- */

/** 2.23 获取或创建进行中的会话 */
function getOrCreateChatSession(sessionType) {
  return post('/chat-sessions/current', { sessionType: sessionType || 3 }, { auth: true })
}

/** 2.24 发送消息（clientMsgId 幂等，重复提交返回同一条） */
function sendChatMessage(sessionId, payload) {
  return post(`/chat-sessions/${sessionId}/messages`, payload, { auth: true })
}

/**
 * 2.25 AI 流式补全（SSE）。
 * @param {string} sessionId
 * @param {object} payload { clientMsgId, replyToMsgId, stream }
 * @param {object} handlers { onEvent, onError, onComplete }
 * @returns {{abort: function}}
 */
function streamChatCompletion(sessionId, payload, handlers) {
  const h = handlers || {}
  return openSse({
    url: `/chat-sessions/${sessionId}/completions`,
    data: payload,
    onEvent: h.onEvent,
    onError: h.onError,
    onComplete: h.onComplete
  })
}

/** ---------- device ---------- */
function syncMockGlucose(readings) {
  return post('/device/glucose-sync', {
    provider: 'MOCK',
    readings: readings || defaultMockReadings()
  }, { auth: true })
}

function defaultMockReadings() {
  const d = new Date()
  const recordDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [
    { recordDate, nodeCode: 'before_breakfast', value: 5.8, unit: 'MMOL_L', externalRecordId: `mock-bb-${recordDate}` },
    { recordDate, nodeCode: 'after_breakfast', value: 7.6, unit: 'MMOL_L', externalRecordId: `mock-ab-${recordDate}` },
    { recordDate, nodeCode: 'before_lunch', value: 6.1, unit: 'MMOL_L', externalRecordId: `mock-bl-${recordDate}` }
  ]
}

module.exports = {
  channelName,
  channelCode,
  wechatLogin,
  sendSmsCode,
  phoneLogin,
  logoutRemote,
  fetchBanners,
  fetchNews,
  fetchNewsDetail,
  updateNewsAction,
  fetchFoodCategories,
  fetchFoods,
  getOrCreateChatSession,
  sendChatMessage,
  streamChatCompletion,
  syncMockGlucose,
  defaultMockReadings,
  mapNewsItem,
  mapBanner,
  mapFood
}
