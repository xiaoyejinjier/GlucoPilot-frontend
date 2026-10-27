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

/** 把管理端保存的 /api/v1/cms/images|videos/{id} 解析成小程序可请求的完整地址。 */
function resolveCmsMedia(url) {
  const source = String(url || '').trim()
  if (!source) return ''
  if (/^https?:\/\//i.test(source)) return source
  if (/^\/api\/v1\/cms\/(images|videos)\/\d+$/.test(source)) {
    return `${String(baseUrl).replace(/\/+$/, '')}${source.slice('/api/v1'.length)}`
  }
  return source
}

/** 正文 HTML：相对 CMS 图地址补全，供 rich-text 使用。 */
function rewriteContentHtml(html) {
  const raw = String(html || '')
  if (!raw) return ''
  const prefix = String(baseUrl).replace(/\/+$/, '')
  return raw.replace(
    /(src|href)=(["'])(\/api\/v1\/cms\/images\/\d+)\2/gi,
    (_m, attr, quote, path) => `${attr}=${quote}${prefix}${path.slice('/api/v1'.length)}${quote}`
  )
}

/** 官方资讯正文为 HTML；社区投稿为纯文本。仅 HTML 才走 rich-text。 */
function looksLikeHtml(text) {
  return /<\/?[a-z][\s\S]*>/i.test(String(text || ''))
}

function mapNewsItem(n) {
  const type = n.contentType === 2 || (n.videos || []).length ? 'video' : 'article'
  const contentBody = n.contentBody || ''
  return {
    id: n.id,
    title: n.title,
    summary: n.summaryText || '',
    channel: channelName(n.channelCode),
    channelCode: n.channelCode,
    type,
    typeLabel: type === 'video' ? '视频' : '图文',
    time: formatTime(n.publishAt),
    cover: resolveCmsMedia(n.coverUrl) || '/assets/news/n1.jpg',
    coverText: '',
    videoUrl: resolveCmsMedia(n.videoUrl) || '',
    contentBody,
    contentHtml: looksLikeHtml(contentBody) ? rewriteContentHtml(contentBody) : '',
    likeCount: n.likeCount || 0,
    collectCount: n.collectCount || 0,
    viewCount: n.viewCount || 0,
    liked: !!n.liked,
    collected: !!n.collected,
    author: n.author || null,
    commentCount: n.commentCount || 0,
    tags: n.tags || [],
    images: n.images || [], videos:n.videos || []
  }
}

function mapBanner(b) {
  return {
    id: b.id,
    title: b.title,
    desc: b.subtitle || '',
    imageUrl: resolveCmsMedia(b.imageUrl),
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
  return get('/news', data, { auth: !!wx.getStorageSync('accessToken') }).then((page) => ({
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

function fetchCommunityProfile(key) { return get(`/community/profiles/${encodeURIComponent(key)}`, null, { auth: true }) }
function fetchEnglishLocalizations(items,retry=false) { return post('/localizations/en',{items,retry},{auth:true,timeout:15000}) }
function fetchMyReports(params) { return get('/community/reports/mine',params,{auth:true}) }
function fetchReportFeedback(id) { return get(`/community/reports/${encodeURIComponent(id)}`,null,{auth:true}) }
function readReportFeedback(id) { return put(`/community/reports/${encodeURIComponent(id)}/read`,null,{auth:true}) }
function setCommunityFollowing(key, following) { return put(`/community/profiles/${encodeURIComponent(key)}/following`, { following }, { auth: true }) }
function fetchCommunityList(mode, params) {
  if (!['following', 'likes', 'collections', 'messages', 'profiles'].includes(mode)) return Promise.reject(new Error('列表类型不正确'))
  return get(`/community/${mode}`, params, { auth: true }).then(page => (mode === 'collections' || mode === 'likes')
    ? { ...page, records: (page.records || []).map(mapNewsItem) } : page)
}
function fetchNewsComments(id, params) { return get(`/news/${id}/comments`, params, { auth: true }) }
function fetchCommentContext(id, commentId) { return get(`/news/${id}/comments/${encodeURIComponent(commentId)}/context`, null, { auth: true }) }
function fetchCommentReplies(id, rootId, params) { return get(`/news/${id}/comments/${rootId}/replies`, params, { auth: true }) }
function addNewsComment(id, payload) { const path = payload.replyToCommentId ? `/news/${id}/comments/${encodeURIComponent(payload.replyToCommentId)}/replies` : `/news/${id}/comments`; return post(path, payload, { auth: true }) }
function deleteNewsComment(id, commentId) { return del(`/news/${id}/comments/${commentId}`, null, { auth: true }) }
function fetchMyComments(params) { return get('/community/comments/mine', params, { auth: true }) }
function fetchDirectMessages(peer, params) { return get(`/community/messages/${encodeURIComponent(peer)}`, params, { auth: true }) }
function fetchUnreadMessages() { return get('/community/messages/unread', null, { auth:true }) }
function fetchInformationSummary() { return get('/community/information/summary', null, { auth:true }) }
function fetchInteractionNotices(kind,params) { return get('/community/notifications',{ ...params,kind },{auth:true}) }
function readInteractionNotices(kind,throughId) { return put('/community/notifications/read',{kind,throughId},{auth:true}) }
function fetchDrafts(params) { return get('/community/drafts',params,{auth:true}) }
function fetchDraft(id) { return get(`/community/drafts/${encodeURIComponent(id)}`,null,{auth:true}) }
function createDraft(payload) { return post('/community/drafts',payload,{auth:true}) }
function updateDraft(id,payload) { return put(`/community/drafts/${encodeURIComponent(id)}`,payload,{auth:true}) }
function deleteDraft(id,revision) { return del(`/community/drafts/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`,null,{auth:true}) }
function publishDraft(id,payload) { return post(`/community/drafts/${encodeURIComponent(id)}/publish`,payload,{auth:true}) }
function createExportTask(payload) { return post('/data-export-tasks',payload,{auth:true}) }
function fetchExportTasks(params) { return get('/data-export-tasks',params,{auth:true}) }
function deleteExportTask(id) { return del(`/data-export-tasks/${encodeURIComponent(id)}`,null,{auth:true}) }
function generateExportTask(id) { return post(`/data-export-tasks/${encodeURIComponent(id)}/generate`,null,{auth:true,timeout:60000}) }
function sendDirectMessage(peer, payload) { return post(`/community/messages/${encodeURIComponent(peer)}`, payload, { auth: true, timeout: 15000 }) }
function readDirectMessages(peer, throughId) { return put(`/community/messages/${encodeURIComponent(peer)}/read`, { throughId }, { auth: true }) }

function fetchMyCommunityTags(includeDisabled=false) { return get('/community/tags/mine',{includeDisabled},{auth:true}) }
function fetchProfileArticles(key,params) { return get(`/community/profiles/${encodeURIComponent(key)}/articles`,params,{auth:true}).then(page=>({...page,records:(page.records || []).map(mapCommunityArticle)})) }
function fetchCommunityTags() { return get('/community/tags', null, { auth: true }) }
function mapCommunityArticle(item) {
  return { ...item, ...mapNewsItem({ ...item, summaryText: item.summary || '', contentBody: item.body || '', channelCode: 4, contentType: (item.videos || []).length ? 2 : 1 }),
    state: item.state, revision: item.revision, body: item.body || '', summary: item.summary || '', hasCover: !!item.coverUrl }
}
function fetchCommunityArticles(params = {}) {
  // 联调以社区接口为准；404 直接抛出，避免回退旧 /news 掩盖未部署社区 API。
  return get('/community/articles', params, { auth: true })
    .then(page => ({ ...page, records: (page.records || []).map(mapCommunityArticle) }))
}
function fetchMyArticles(params) { return get('/community/articles/mine', params, { auth: true }) }
function fetchMutualFriends(params) { return get('/community/friends',params,{auth:true}) }
function setArticleVisibility(id,payload) { return put(`/community/articles/${encodeURIComponent(id)}/visibility`,payload,{auth:true}) }
function hideCommunityArticle(id) { return put(`/community/articles/${encodeURIComponent(id)}/hidden`,{hidden:true},{auth:true}) }
function recordArticleView(id) { return post(`/community/articles/${encodeURIComponent(id)}/views`,null,{auth:true}) }
function fetchCommunityArticle(id) { return get(`/community/articles/${encodeURIComponent(id)}`, null, { auth: true }) }
function submitCommunityArticle(payload) { return post('/community/articles', payload, { auth: true, timeout: 15000 }) }
function editCommunityArticle(id, payload) { return put(`/community/articles/${encodeURIComponent(id)}`, payload, { auth: true, timeout: 15000 }) }
function retryArticleAi(id) { return post(`/community/articles/${encodeURIComponent(id)}/retry-ai`, null, { auth: true }) }
function reportCommunityContent(payload) { return post('/community/reports', payload, { auth: true }) }

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

/** ---------- device ---------- */
/** 当前用户已绑定设备列表。 */
function fetchMyDevices() {
  return get('/devices', null, { auth: true }).then((list) => (list || []).map(mapDeviceItem))
}

function mapDeviceItem(d) {
  return {
    id: String(d.id),
    deviceSn: d.deviceSn || '',
    deviceName: d.deviceName || '我的血糖仪',
    provider: String(d.provider || 'MOCK').toUpperCase(),
    deviceStatus: d.deviceStatus == null ? 1 : Number(d.deviceStatus),
    lastSyncAt: d.lastSyncAt || '',
    bound: d.bound !== false
  }
}

/** 自助绑定：deviceSn + provider，名称可选。 */
function bindDevice(payload) {
  return post('/devices/bind', {
    deviceSn: payload.deviceSn,
    provider: payload.provider,
    deviceName: payload.deviceName || undefined
  }, { auth: true }).then(mapDeviceItem)
}

/** 解绑本人设备（清空归属，保留档案）。 */
function unbindDevice(id) {
  return post(`/devices/${id}/unbind`, {}, { auth: true })
}

/**
 * 本人设备近 N 次同步流水（默认 10）。
 * @param {string|number} deviceId
 * @param {number} [limit=10]
 */
function fetchDeviceSyncLogs(deviceId, limit) {
  const size = limit == null ? 10 : Number(limit)
  return get(`/devices/${deviceId}/sync-logs`, { limit: size }, { auth: true }).then((list) =>
    (list || []).map((row) => ({
      id: String(row.id),
      provider: String(row.provider || '').toUpperCase(),
      sampleCount: row.sampleCount == null ? 0 : Number(row.sampleCount),
      createdCount: row.createdCount == null ? 0 : Number(row.createdCount),
      remark: row.remark || '',
      syncedAt: row.syncedAt || ''
    }))
  )
}

/**
 * 设备同步总线：上传厂商/入口 raw payload。
 * @param {{ provider: string, deviceSn?: string, payload: object|array }} opts
 */
function syncDeviceGlucose(opts) {
  const body = {
    provider: String(opts.provider || '').toUpperCase(),
    payload: opts.payload
  }
  if (opts.deviceSn) body.deviceSn = opts.deviceSn
  return post('/device/glucose-sync', body, { auth: true })
}

/**
 * 选厂商 → 自动绑定模拟设备 → 随机 payload 同步。
 * @param {string} provider
 */
function createSimDeviceAndSync(provider) {
  const {
    buildRandomPayload,
    providerLabel,
    generateSimDeviceSn
  } = require('./device-sim-generator')
  const code = String(provider || '').toUpperCase()
  const deviceSn = generateSimDeviceSn(code)
  const deviceName = providerLabel(code)
  const payload = buildRandomPayload(code)
  return bindDevice({ deviceSn, provider: code, deviceName }).then((device) =>
    syncDeviceGlucose({ provider: code, deviceSn, payload }).then((syncResult) => ({
      device,
      syncResult,
      deviceSn,
      provider: code
    }))
  )
}

/**
 * MOCK 同步演示读数。可附带 deviceSn 以刷新 last_sync_at。
 * @param {Array|undefined} readings
 * @param {string|undefined} deviceSn
 */
function syncMockGlucose(readings, deviceSn) {
  return syncDeviceGlucose({
    provider: 'MOCK',
    deviceSn,
    payload: { readings: readings || defaultMockReadings() }
  })
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

/** 只返回语音草稿，发送仍由用户确认后调用sendChatMessage。 */
function transcribeSpeech(payload) {
  return post('/speech-transcriptions', payload, { auth: true, timeout: 60000 })
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
  fetchEnglishLocalizations,
  fetchMutualFriends,setArticleVisibility,hideCommunityArticle,recordArticleView,
  fetchInformationSummary, fetchInteractionNotices, readInteractionNotices,
  fetchDrafts, fetchDraft, createDraft, updateDraft, deleteDraft, publishDraft,
  createExportTask, fetchExportTasks, generateExportTask, deleteExportTask,
  fetchMyCommunityTags, fetchProfileArticles, fetchCommunityTags, fetchCommunityArticles, fetchMyArticles, fetchCommunityArticle,
  submitCommunityArticle, editCommunityArticle, retryArticleAi, reportCommunityContent,
  fetchCommunityProfile, setCommunityFollowing, fetchCommunityList, fetchMyReports, fetchReportFeedback, readReportFeedback,
  fetchNewsComments, fetchCommentContext, fetchCommentReplies, addNewsComment, deleteNewsComment, fetchMyComments,
  fetchDirectMessages, sendDirectMessage, readDirectMessages, fetchUnreadMessages,
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
  fetchMyDevices,
  bindDevice,
  unbindDevice,
  fetchDeviceSyncLogs,
  syncDeviceGlucose,
  createSimDeviceAndSync,
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
  transcribeSpeech,
  mapNewsItem,
  mapBanner,
  mapFood
}
