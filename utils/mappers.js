/** 频道 / 展示字段映射（后端数字枚举 ↔ 前端文案） */

const { getFoodImage } = require('./food-images')

const CHANNEL_CODE_TO_NAME = {
  1: '企业动态',
  2: '行业快讯',
  3: '设备新知',
  4: '控糖科普'
}

const CHANNEL_NAME_TO_CODE = {
  企业动态: 1,
  行业快讯: 2,
  设备新知: 3,
  控糖科普: 4
}

function formatNewsTime(publishAt) {
  if (!publishAt) return ''
  const s = String(publishAt).replace('T', ' ')
  return s.length > 16 ? s.slice(0, 16) : s
}

function mapBanner(item) {
  return {
    id: item.id,
    title: item.title || '',
    desc: item.subtitle || '',
    imageUrl: item.imageUrl || '',
    linkUrl: item.linkUrl || ''
  }
}

function mapNewsItem(item) {
  const channelCode = item.channelCode
  const contentType = item.contentType
  const isVideo = contentType === 2
  return {
    id: item.id,
    title: item.title || '',
    summary: item.summaryText || '',
    channel: CHANNEL_CODE_TO_NAME[channelCode] || '资讯',
    channelCode,
    type: isVideo ? 'video' : 'article',
    typeLabel: isVideo ? '视频' : '图文',
    time: formatNewsTime(item.publishAt),
    cover: item.coverUrl || '/assets/news/n1.jpg',
    coverText: isVideo ? '▶' : '资讯',
    videoUrl: item.videoUrl || '',
    contentBody: item.contentBody || '',
    likeCount: item.likeCount || 0,
    collectCount: item.collectCount || 0,
    liked: !!item.liked,
    collected: !!item.collected
  }
}

function mapFood(item) {
  const image = getFoodImage(item.foodName, item.categoryName, item.imageUrl)
  return {
    id: item.id,
    name: item.foodName || '',
    carbs: item.carbsPer100g != null ? Number(item.carbsPer100g) : 0,
    cal: item.caloriesPer100g != null ? Number(item.caloriesPer100g) : 0,
    gi: item.giValue != null ? Number(item.giValue) : null,
    categoryCode: item.categoryCode,
    categoryId: item.categoryId,
    categoryName: item.categoryName || '',
    imageUrl: item.imageUrl || '',
    image
  }
}

function mapFoodCategory(item) {
  return {
    id: item.id,
    name: item.categoryName || '',
    sortNo: item.sortNo
  }
}

/** ---------- 用户 / 健康档案 / 设置 ---------- */

const DIABETES_TYPE_TEXT = ['未填写', '1 型糖尿病', '2 型糖尿病', '妊娠糖尿病', '其他']
const GENDER_TEXT = ['未填写', '男', '女']
const FEEDBACK_TYPE_TEXT = ['', '产品建议', 'Bug问题', '功能诉求', '其他']
const FEEDBACK_STATUS_TEXT = ['已收到', '处理中', '已处理', '已关闭']
const SOURCE_TYPE_TEXT = ['', '手动录入', '拍照识别', '设备同步']

/** 后端数字枚举 ↔ 端上展示键（utils/display 用的是中文名与英文主题 id） */
const FONT_CODE_TO_NAME = ['', '标准', '较大', '更大']
const FONT_NAME_TO_CODE = { 标准: 1, 较大: 2, 更大: 3 }
const THEME_CODE_TO_ID = ['', 'green', 'teal', 'simple']
const THEME_ID_TO_CODE = { green: 1, teal: 2, simple: 3 }

function fontNameOf(code) {
  return FONT_CODE_TO_NAME[code] || '较大'
}

function fontCodeOf(name) {
  return FONT_NAME_TO_CODE[name] || 2
}

function themeIdOf(code) {
  return THEME_CODE_TO_ID[code] || 'green'
}

function themeCodeOf(id) {
  return THEME_ID_TO_CODE[id] || 1
}

function diabetesText(code) {
  return DIABETES_TYPE_TEXT[code] || '未填写'
}

/** 中文类型 → 数字枚举；无法识别返回 0（未填写）。 */
function diabetesCode(text) {
  const idx = DIABETES_TYPE_TEXT.indexOf(String(text || '').trim())
  if (idx > 0) return idx
  return Number(text) >= 0 && Number(text) <= 4 ? Number(text) : 0
}

function formatDateTime(value) {
  if (!value) return ''
  const s = String(value).replace('T', ' ')
  return s.length >= 16 ? s.slice(0, 16) : s
}

/**
 * /users/me 聚合成页面直接可用的扁平结构。
 * 同时保留 diabetesType（中文，供档案展示）与 diabetesTypeCode（数字，供提交）。
 */
function mapUserMe(me) {
  const profile = me.profile || {}
  const health = me.health || {}
  const settings = me.settings || {}
  const typeText = diabetesText(health.diabetesType)
  const age = health.age == null ? '' : health.age
  return {
    accountStatus: me.accountStatus,
    phoneMasked: me.phoneMasked || '',
    nickname: profile.nickname || '',
    avatarUrl: profile.avatarUrl || '',
    avatarText: profile.avatarText || (profile.nickname || '用').charAt(0),
    gender: profile.gender == null ? 0 : profile.gender,
    genderText: GENDER_TEXT[profile.gender] || '未填写',
    diabetesType: typeText,
    /** 「2 型糖尿病 · 42 岁」这类摘要，缺失项自动省略 */
    profileDesc: [typeText, age ? `${age} 岁` : ''].filter((s) => s && s !== '未填写').join(' · ') || '资料待完善',
    diabetesTypeCode: health.diabetesType == null ? 0 : health.diabetesType,
    diabetesTypeText: health.diabetesTypeText || '',
    confirmDate: health.diagnosedYm || '',
    age,
    medication: health.medication || '',
    exercise: health.exerciseHabit || '',
    targetFasting: health.targetFasting,
    targetPostprandial: health.targetPostprandial,
    fontSize: settings.fontSize == null ? 2 : settings.fontSize,
    themeCode: settings.themeCode == null ? 1 : settings.themeCode,
    notifyGlucose: !!settings.notifyGlucose,
    notifyMeal: !!settings.notifyMeal,
    notifyNews: !!settings.notifyNews,
    disclaimerAgreed: !!settings.disclaimerAgreed,
    disclaimerVersion: settings.disclaimerVersion || ''
  }
}

/** ---------- 血糖 ---------- */

function mapGlucoseRecord(r) {
  return {
    id: r.id,
    recordDate: r.recordDate,
    nodeCode: r.nodeCode,
    nodeName: r.nodeName || r.nodeCode,
    value: r.glucoseValue,
    sourceType: r.sourceType,
    sourceText: SOURCE_TYPE_TEXT[r.sourceType] || '',
    mediaId: r.mediaId || '',
    remark: r.remark || '',
    recordedAt: r.recordedAt,
    time: formatDateTime(r.recordedAt)
  }
}

/** 日看板：节点格子 + 折线点，字段名对齐 pages/ai 的既有用法。 */
function mapDayBoard(board) {
  const nodes = (board.nodes || []).map((n) => ({
    id: n.nodeCode,
    nodeCode: n.nodeCode,
    name: n.nodeName || n.nodeCode,
    short: n.nodeName || n.nodeCode,
    isMeal: !!n.isMeal,
    hasRecord: !!n.hasRecord,
    recordKind: n.recordKind || '',
    value: n.glucose ? n.glucose.glucoseValue : null,
    remark: n.glucose ? n.glucose.remark || '' : ''
  }))
  return {
    recordDate: board.recordDate,
    recordedCount: board.recordedCount || 0,
    totalNodes: board.totalNodes || nodes.length,
    nodes,
    chartPoints: board.chartPoints || []
  }
}

/** 统计摘要：字段名对齐 pages/stats 的既有用法。 */
function mapSummary(summary) {
  const calendar = summary.calendar || {}
  const monthStats = summary.monthStats || {}
  const week = summary.week || {}
  const checkIn = summary.checkIn || {}

  const calendarMap = {}
  let monthTotal = 0
  ;(calendar.days || []).forEach((d) => {
    calendarMap[d.day] = { level: d.level, count: d.recordCount }
    monthTotal += d.recordCount
  })

  return {
    year: calendar.year,
    month: calendar.month,
    calendarMap,
    monthRecordDays: monthStats.recordDays || 0,
    monthTotal,
    compliance: monthStats.complianceRate == null ? 0 : Math.round(monthStats.complianceRate * 100),
    monthAvg: monthStats.avgValue,
    monthMax: monthStats.maxValue,
    monthMin: monthStats.minValue,
    week: {
      startDate: week.startDate,
      endDate: week.endDate,
      labels: week.labels || [],
      points: (week.points || []).map((p) => ({ ...p, value: p.avg })),
      avg: week.avg,
      max: week.max,
      min: week.min
    },
    slotStats: (summary.slotStats || []).map((s) => ({
      name: s.name,
      count: s.count || 0,
      pct: s.pct || 0
    })),
    trend: summary.trend || [],
    todayCount: checkIn.todayCount || 0,
    todayAvg: checkIn.todayAvg,
    totalNodes: checkIn.totalNodes || 9,
    streakDays: checkIn.streakDays || 0
  }
}

/** ---------- 反馈 ---------- */

function mapFeedback(f) {
  return {
    id: f.id,
    typeCode: f.feedbackType,
    type: FEEDBACK_TYPE_TEXT[f.feedbackType] || '其他',
    content: f.contentText || '',
    statusCode: f.replyStatus,
    status: FEEDBACK_STATUS_TEXT[f.replyStatus] || '已收到',
    officialReply: f.officialReply || '',
    repliedAt: f.repliedAt,
    time: formatDateTime(f.createdAt)
  }
}

module.exports = {
  CHANNEL_CODE_TO_NAME,
  CHANNEL_NAME_TO_CODE,
  DIABETES_TYPE_TEXT,
  FEEDBACK_TYPE_TEXT,
  FEEDBACK_STATUS_TEXT,
  FONT_CODE_TO_NAME,
  THEME_CODE_TO_ID,
  mapBanner,
  mapNewsItem,
  mapFood,
  mapFoodCategory,
  mapUserMe,
  mapGlucoseRecord,
  mapDayBoard,
  mapSummary,
  mapFeedback,
  diabetesText,
  diabetesCode,
  fontNameOf,
  fontCodeOf,
  themeIdOf,
  themeCodeOf,
  formatDateTime
}
