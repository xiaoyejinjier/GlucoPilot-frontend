const { get, post, put, patch, del, setToken } = require('../utils/request')
const { baseUrl } = require('../utils/config')
const mappers = require('../utils/mappers')
const { getFoodImage } = require('../utils/food-images')
const { openSse } = require('../utils/sse')
const {
  normalizeSessionPage,
  normalizeHistoryPage,
  buildSessionListQuery,
  buildHistoryQuery
} = require('../utils/chat-sessions')

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

/** 把管理端保存的 /api/v1/cms/images/{id} 解析成小程序可请求的完整地址。 */
function resolveCmsImage(url) {
  const source = String(url || '').trim()
  if (!source) return ''
  if (/^https?:\/\//i.test(source)) return source
  if (/^\/api\/v1\/cms\/images\/\d+$/.test(source)) {
    return `${String(baseUrl).replace(/\/+$/, '')}${source.slice('/api/v1'.length)}`
  }
  return source
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
    cover: resolveCmsImage(n.coverUrl) || '/assets/news/n1.jpg',
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
    imageUrl: resolveCmsImage(b.imageUrl),
    linkUrl: b.linkUrl || ''
  }
}

function mapFood(f, categoryName) {
  const resolvedCategoryName = categoryName || f.categoryName || ''
  return {
    id: f.id,
    name: f.foodName,
    category: resolvedCategoryName,
    categoryCode: f.categoryCode,
    carbs: f.carbsPer100g,
    cal: f.caloriesPer100g,
    gi: f.giValue,
    imageUrl: f.imageUrl || '',
    image: getFoodImage(f.foodName, resolvedCategoryName, f.imageUrl)
  }
}

/** ---------- auth ---------- */
function wechatLogin(code) {
  return post('/auth/wechat/sessions', { code }, { auth: false, timeout: 15000 }).then((data) => {
    setToken(data.accessToken)
    wx.setStorageSync('isLoggedIn', true)
    return data
  })
}

function sendSmsCode(phone, scene) {
  return post('/auth/sms/codes', { phone, scene: scene || 'login' }, { auth: false, timeout: 15000 })
}

function phoneLogin(phone, smsCode) {
  return post('/auth/phone/sessions', { phone, smsCode }, { auth: false, timeout: 15000 }).then((data) => {
    setToken(data.accessToken)
    wx.setStorageSync('isLoggedIn', true)
    return data
  })
}

function sendEmailCode(email, scene) {
  return post('/auth/email/codes', { email, scene: scene || 'login' }, { auth: false })
}

function emailLogin(email, emailCode) {
  return post('/auth/email/sessions', { email, emailCode }, { auth: false }).then((data) => {
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
  if (params && params.categoryId) data.categoryId = params.categoryId
  if (params && params.categoryCode) data.categoryCode = params.categoryCode
  if (params && params.keyword) data.keyword = params.keyword
  return get('/foods', data, { auth: false }).then((page) => {
    // 兼容尚未重启的旧后端（直接返回数组）与新版 PageResult。
    const source = Array.isArray(page) ? page : (page && page.records ? page.records : [])
    const records = source.map((f) => mapFood(f))
    if (Array.isArray(page)) {
      return { pageNum: 1, pageSize: records.length, total: records.length, pages: records.length ? 1 : 0, records }
    }
    return { ...page, records }
  })
}

function fetchFoodDetail(id) {
  return get(`/foods/${id}`, null, { auth: false }).then(mapFood)
}

/** ---------- chat（接口文档 2.23 / 2.24 / 2.25，外加 5.3 / 5.4 与历史读取） ---------- */

/** 2.23 获取或创建进行中的会话 */
function getOrCreateChatSession(sessionType) {
  return post('/chat-sessions/current', { sessionType: sessionType || 3 }, { auth: true, timeout: 10000 })
}

/**
 * 2.23 + forceNew 新建会话：后端在同一事务里把旧会话置为"已结束"再建新的。
 * 不传 forceNew 才是"取或建当前会话"（getOrCreateChatSession），两者语义不同，别混用。
 */
function createChatSession(sessionType) {
  return post('/chat-sessions/current', { sessionType: sessionType || 3, forceNew: true }, { auth: true })
}

/**
 * 5.3 会话列表（分页）。
 * 归一化放在 utils/chat-sessions：id/total 是后端 Long 序列化出来的**字符串**，
 * 页面侧只当字符串用，所以这里统一过一次，别让每个页面各写一份。
 */
function fetchChatSessions(params) {
  return get('/chat-sessions', buildSessionListQuery(params), { auth: true })
    .then((page) => normalizeSessionPage(page))
}

/** 5.4 删除会话（幂等：重复删除同样返回成功；会话内消息一并删除）。 */
function deleteChatSession(sessionId) {
  return del(`/chat-sessions/${sessionId}`, null, { auth: true })
}

/** 置顶 / 取消置顶。 */
function setChatSessionPinned(sessionId, isPinned) {
  return patch(`/chat-sessions/${sessionId}/pinned`, { isPinned: !!isPinned }, { auth: true })
}

/**
 * 会话内历史消息（全部历史，与模型记忆窗口无关）。
 * @param {string} sessionId
 * @param {object} params { pageSize, beforeSeq } —— beforeSeq 传上一页的 nextBeforeSeq
 * @returns {Promise<{messages: Array, hasMore: boolean, nextBeforeSeq: (number|null)}>}
 */
function fetchChatHistory(sessionId, params) {
  return get(`/chat-sessions/${sessionId}/messages`, buildHistoryQuery(params), { auth: true, timeout: 10000 })
    .then((page) => normalizeHistoryPage(page))
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

/** ---------- media（接口 2.14 上传凭证 / 2.15 登记媒体） ---------- */

/** 2.14 取预签名直传凭证。返回 { uploadUrl, storageKey, expireIn }。 */
function createMediaUploadCredential(bizType, mimeType, sizeBytes) {
  return post('/media-files/upload-credentials', { bizType, mimeType, sizeBytes }, { auth: true })
}

/**
 * 2.15 登记已直传的对象，返回 media_file 记录（含 id，供 2.24 的 mediaId 使用）。
 * sha256Hex 可选：留空即跳过去重，由服务端按需处理。
 */
function registerMediaFile(payload) {
  return post('/media-files', payload, { auth: true })
}

/** ---------- OCR（接口 2.21 创建任务 / 2.22 查询任务） ---------- */

function createOcrTask(mediaId, bizType, idempotencyKey) {
  return post('/ocr-tasks', { mediaId, bizType }, {
    auth: true,
    header: { 'X-Idempotency-Key': idempotencyKey }
  })
}

function fetchOcrTask(id) {
  return get(`/ocr-tasks/${id}`, null, { auth: true })
}

/** ---------- meal（正餐记录） ---------- */

function analyzeMealPhoto(payload, idempotencyKey) {
  return post('/meal-analysis', payload, {
    auth: true,
    timeout: 90000,
    header: { 'X-Idempotency-Key': idempotencyKey }
  })
}

function predictMealGlucose(payload) {
  return post('/predictions/meal-glucose', payload, { auth: true })
}

function saveMealRecord(payload) {
  return post('/meal-records', payload, { auth: true })
}

function fetchDayMeals(recordDate) {
  return get('/meal-records', { recordDate }, { auth: true })
}

/** 删除餐食记录（后端逻辑删除主记录并级联明细）；当前无删除 UI，先提供封装。 */
function deleteMealRecord(id) {
  return del(`/meal-records/${id}`, null, { auth: true })
}

/** ---------- device ---------- */
function syncMockGlucose(readings) {
  return post('/device/glucose-sync', {
    provider: 'MOCK',
    payload: { readings: readings || defaultMockReadings() }
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

/** ---------- user / 设置 / 反馈 ---------- */
function fetchMe() {
  return get('/users/me', null, { auth: true, timeout: 10000 }).then(mappers.mapUserMe)
}

function updateProfile(payload) {
  return patch('/users/me/profile', payload, { auth: true })
}

function saveHealthProfile(payload) {
  return put('/users/me/health-profile', payload, { auth: true })
}

function updateSettings(payload) {
  return patch('/users/me/settings', payload, { auth: true })
}

function agreeDisclaimer(disclaimerVersion) {
  return post('/users/me/settings/disclaimer-agreement', { disclaimerVersion }, { auth: true })
}

function bindPhone(phone, verifyCode) {
  return patch('/users/me/phone', { phone, verifyCode }, { auth: true })
}

function bindEmail(email, verifyCode) {
  return patch('/users/me/email', { email, verifyCode }, { auth: true })
}

function fetchAppConfig(groups) {
  const data = {}
  if (groups && groups.length) data.groups = groups.join(',')
  return get('/app-config', data, { auth: false, timeout: 10000 })
}

function submitFeedback(feedbackType, contentText) {
  return post('/feedbacks', { feedbackType, contentText }, { auth: true })
}

function fetchFeedbacks(pageNum, pageSize) {
  return get('/feedbacks', { pageNum: pageNum || 1, pageSize: pageSize || 20 }, { auth: true })
    .then((page) => ({
      ...page,
      records: (page && page.records ? page.records : []).map(mappers.mapFeedback)
    }))
}

/** ---------- glucose ---------- */
function upsertGlucoseRecord(payload) {
  return put('/glucose-records/by-node', payload, { auth: true })
}

function fetchGlucoseRecords(params) {
  const data = {
    pageNum: (params && params.pageNum) || 1,
    pageSize: (params && params.pageSize) || 50
  }
  if (params && params.startDate) data.startDate = params.startDate
  if (params && params.endDate) data.endDate = params.endDate
  if (params && params.nodeCode) data.nodeCode = params.nodeCode
  return get('/glucose-records', data, { auth: true }).then((page) => ({
    ...page,
    records: (page && page.records ? page.records : []).map(mappers.mapGlucoseRecord)
  }))
}

function updateGlucoseRecord(id, payload) {
  return patch(`/glucose-records/${id}`, payload, { auth: true }).then(mappers.mapGlucoseRecord)
}

function deleteGlucoseRecord(id) {
  return del(`/glucose-records/${id}`, null, { auth: true })
}

function fetchDayBoard(recordDate) {
  return get(`/day-boards/${recordDate}`, null, { auth: true }).then(mappers.mapDayBoard)
}

function fetchGlucoseNodes() {
  return get('/dict/glucose-nodes', null, { auth: false })
}

/** 当前登录用户的异常事件公开回复；内部备注由服务端隔离。 */
function fetchGlucoseAlertReplies(pageNum, pageSize) {
  return get('/glucose-alerts/replies', { pageNum: pageNum || 1, pageSize: pageSize || 3 }, { auth: true })
}

/** ---------- statistics ---------- */
function fetchGlucoseSummary(params) {
  const data = {}
  if (params && params.year) data.year = params.year
  if (params && params.month) data.month = params.month
  if (params && params.startDate) data.startDate = params.startDate
  if (params && params.endDate) data.endDate = params.endDate
  if (params && params.trendDays) data.trendDays = params.trendDays
  return get('/glucose-records/summary', data, { auth: true }).then(mappers.mapSummary)
}

module.exports = {
  channelName,
  channelCode,
  wechatLogin,
  sendSmsCode,
  phoneLogin,
  sendEmailCode,
  emailLogin,
  logoutRemote,
  fetchBanners,
  fetchNews,
  fetchNewsDetail,
  updateNewsAction,
  fetchFoodCategories,
  fetchFoods,
  fetchFoodDetail,
  getOrCreateChatSession,
  createChatSession,
  fetchChatSessions,
  fetchChatHistory,
  deleteChatSession,
  setChatSessionPinned,
  sendChatMessage,
  streamChatCompletion,
  createMediaUploadCredential,
  registerMediaFile,
  createOcrTask,
  fetchOcrTask,
  saveMealRecord,
  analyzeMealPhoto,
  predictMealGlucose,
  fetchDayMeals,
  deleteMealRecord,
  syncMockGlucose,
  defaultMockReadings,
  fetchMe,
  updateProfile,
  saveHealthProfile,
  updateSettings,
  agreeDisclaimer,
  bindPhone,
  bindEmail,
  fetchAppConfig,
  submitFeedback,
  fetchFeedbacks,
  upsertGlucoseRecord,
  fetchGlucoseRecords,
  updateGlucoseRecord,
  deleteGlucoseRecord,
  fetchDayBoard,
  fetchGlucoseNodes,
  fetchGlucoseAlertReplies,
  fetchGlucoseSummary,
  mapNewsItem,
  mapBanner,
  mapFood
}
