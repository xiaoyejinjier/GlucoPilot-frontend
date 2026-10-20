/**
 * AI 会话生命周期的纯函数集合：列表记录归一化、状态门禁文案、历史消息映射、翻页参数。
 *
 * 刻意不碰网络、页面与 wx API：这样 tools/tests 能直接把它当普通模块单测，
 * 也避免同一套换算在对话页和历史页里各写一遍（写两遍迟早只改一边）。
 *
 * 与后端契约有关的三条硬约束（读 ChatController / ChatSessionService / ChatMessageService 得来）：
 * 1. 会话列表里的 `id`、`total` 是**字符串**（后端把 Long 序列化成字符串防精度丢失），
 *    只当字符串用，不做数值运算；`id` 同时是去重键。
 * 2. 只有「进行中(1)」的会话能继续发消息，已结束(2)/已归档(0) 会被后端以 code 40001 拒绝，
 *    所以端上要能按状态提前禁用输入区（状态未知时先放行，由后端兜底纠正）。
 * 3. 会话内历史接口按 seq_no 倒序取一页后**反转成正序**返回，`beforeSeq` 传上一页的
 *    `nextBeforeSeq`；返回的是全部历史，与模型记忆窗口无关。
 */

/** 会话状态：0 归档 / 1 进行中 / 2 已结束（与 CodeEnum.ChatSessionStatus 一致） */
const SESSION_STATUS = { ARCHIVED: 0, ACTIVE: 1, ENDED: 2 }

const SESSION_STATUS_TEXT = { 0: '已归档', 1: '进行中', 2: '已结束' }

/** 会话内历史默认每页条数（后端默认 20、上限 100） */
const HISTORY_PAGE_SIZE = 20

/** 后端 BIZ_REJECTED：已结束/已归档会话被拒绝发送时返回的业务码 */
const BIZ_REJECTED = 40001

const ENDED_NOTICE = '该对话已结束，请退出小语后重新进入'
const ARCHIVED_NOTICE = '该对话已归档，请退出小语后重新进入'

/** 后端默认标题；历史会话拿不到标题时用它兜底展示 */
const DEFAULT_TITLE = '新对话'

function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 解析后端返回的本地时间字符串（形如 `2026-10-15T09:12:33`）。
 * 不直接用 `new Date(str)`：带空格的形式在 iOS 上解析成 Invalid Date，
 * 逐段取值能避开各端 JS 引擎的差异。
 */
function parseDateTime(value) {
  if (!value) return null
  const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!matched) return null
  return {
    y: Number(matched[1]),
    m: Number(matched[2]),
    d: Number(matched[3]),
    hh: Number(matched[4]),
    mm: Number(matched[5])
  }
}

/** 列表时间文案：今天显示 HH:mm，同年更早显示 MM-DD，跨年显示 YYYY-MM-DD。 */
function formatSessionTime(value, now) {
  const t = parseDateTime(value)
  if (!t) return ''
  const ref = now || new Date()
  if (t.y === ref.getFullYear() && t.m === ref.getMonth() + 1 && t.d === ref.getDate()) {
    return `${pad2(t.hh)}:${pad2(t.mm)}`
  }
  if (t.y === ref.getFullYear()) return `${pad2(t.m)}-${pad2(t.d)}`
  return `${t.y}-${pad2(t.m)}-${pad2(t.d)}`
}

/** Long 字段统一按字符串处理；空值给空串，避免渲染出 "null"/"undefined"。 */
function toIdString(value) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function normalizeStatus(value) {
  if (value === null || value === undefined || value === '') return null
  const code = Number(value)
  return Number.isFinite(code) ? code : null
}

function sessionStatusText(status) {
  const code = normalizeStatus(status)
  return code === null ? '' : (SESSION_STATUS_TEXT[code] || '')
}

/**
 * 状态门禁：只有「进行中」能发消息。
 * 状态未知（缺字段/新状态值）时**不**禁用输入，交给后端 requireActive 兜底拒绝，
 * 否则接口稍微变一下就会把用户锁死在只读界面里。
 */
function canSendInSession(status) {
  const code = normalizeStatus(status)
  if (code === null) return true
  return code === SESSION_STATUS.ACTIVE
}

/** 输入区禁用标记与提示文案；可发送时 notice 为空串。 */
function sessionGate(status) {
  const code = normalizeStatus(status)
  if (code === SESSION_STATUS.ENDED) {
    return { sessionStatus: code, sessionStatusText: sessionStatusText(code), readOnly: true, notice: ENDED_NOTICE }
  }
  if (code === SESSION_STATUS.ARCHIVED) {
    return { sessionStatus: code, sessionStatusText: sessionStatusText(code), readOnly: true, notice: ARCHIVED_NOTICE }
  }
  return { sessionStatus: code, sessionStatusText: sessionStatusText(code), readOnly: false, notice: '' }
}

/**
 * 把"发送被后端拒绝"的错误翻译成只读门禁。
 * 返回 null 表示这个错误与会话状态无关，调用方按普通失败处理。
 * 依据是后端文案（"该会话已结束/已归档，不能继续发送消息"）+ 业务码 40001，两者命中其一即可。
 */
function gateFromError(err) {
  const code = err && err.code
  const message = (err && err.message) || ''
  const rejected = code === BIZ_REJECTED || /已结束|已归档/.test(message)
  if (!rejected) return null
  const archived = /已归档/.test(message)
  return sessionGate(archived ? SESSION_STATUS.ARCHIVED : SESSION_STATUS.ENDED)
}

/** 单条会话列表记录 → 页面直接可渲染的结构。 */
function normalizeSessionRow(raw, now) {
  const row = raw || {}
  const id = toIdString(row.id)
  const gate = sessionGate(row.sessionStatus)
  const time = row.lastMsgAt || row.createdAt || ''
  const msgCount = Number(row.msgCount)
  const title = String(row.title || '').trim()
  return {
    id,
    title: title || DEFAULT_TITLE,
    sessionStatus: gate.sessionStatus,
    sessionStatusText: gate.sessionStatusText,
    sessionType: row.sessionType == null ? 3 : Number(row.sessionType),
    msgCount: Number.isFinite(msgCount) && msgCount > 0 ? msgCount : 0,
    isPinned: !!row.isPinned,
    lastMsgAt: row.lastMsgAt || '',
    createdAt: row.createdAt || '',
    lastMessagePreview: String(row.lastMessagePreview || '').trim(),
    timeText: formatSessionTime(time, now),
    canSend: canSendInSession(row.sessionStatus),
    readOnly: gate.readOnly
  }
}

/** 列表分页响应 → { records, total, archiveIdleDays }；total 保持字符串。 */
function normalizeSessionPage(page, now) {
  const source = page && Array.isArray(page.records) ? page.records : []
  return {
    records: source.map((row) => normalizeSessionRow(row, now)),
    total: page && page.total != null ? String(page.total) : String(source.length),
    archiveIdleDays: page && page.archiveIdleDays != null ? Number(page.archiveIdleDays) : 0
  }
}

/** 历史记录按 seqNo 正序排列；seqNo 缺失时保持后端给的顺序（稳定排序）。 */
function compareSeq(a, b) {
  const x = Number(a && a.seqNo)
  const y = Number(b && b.seqNo)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
  return x - y
}

/**
 * 单条历史消息 → 对话页消息结构。
 * 图片消息用服务端解析好的 mediaUrl 渲染；mediaUrl 为空（媒体已删除/过期）时留空，
 * 由模板显示"图片已失效"，而不是塞一个假的本地路径。
 */
function mapHistoryMessage(row) {
  const isImage = Number(row && row.msgType) === 2
  const seqNo = Number(row && row.seqNo)
  const mediaUrl = (row && row.mediaUrl) || ''
  return {
    // 服务端 id 前缀 h，和本页新消息的本地 id（m1、m2…）区分开，避免 wx:key 撞车
    id: `h${row && row.id != null ? String(row.id) : (Number.isFinite(seqNo) ? seqNo : Math.random().toString(36).slice(2))}`,
    role: Number(row && row.msgRole) === 1 ? 'user' : 'ai',
    type: isImage ? 'image' : 'text',
    content: (row && row.contentText) || (Number(row && row.msgType) === 3 ? '［语音消息］' : ''),
    fileUrl: isImage ? mediaUrl : '',
    imagePath: '',
    seqNo: Number.isFinite(seqNo) ? seqNo : 0,
    createdAt: (row && row.createdAt) || '',
    timeLabel: row && row.createdAt ? String(row.createdAt).replace('T', ' ').slice(0, 16) : '',
    serverId: row && row.id,
    mediaId: row && row.mediaId,
    imageUnavailable: isImage && !mediaUrl,
    history: true,
    finishReason: row && row.finishReason != null ? row.finishReason : null,
    /** 历史消息没有"待生成/可重试"语义，标记出来供模板区分 */
    fromHistory: true
  }
}

/**
 * 历史分页响应 → { messages, hasMore, nextBeforeSeq }。
 * 只渲染用户(1)与助手(2)两类角色：系统(3)消息不进对话视图。
 */
function normalizeHistoryPage(page) {
  const source = page && Array.isArray(page.records) ? page.records : []
  const messages = source
    .filter((row) => row && (Number(row.msgRole) === 1 || Number(row.msgRole) === 2))
    .slice()
    .sort(compareSeq)
    .map(mapHistoryMessage)
  return {
    messages,
    hasMore: !!(page && page.hasMore),
    nextBeforeSeq: page && page.nextBeforeSeq != null ? page.nextBeforeSeq : null
  }
}

/** 翻页拼装：更早的一页在前，保持整段对话正序。 */
function mergeHistory(olderMessages, currentMessages) {
  return (olderMessages || []).concat(currentMessages || [])
}

/**
 * 会话内历史的查询参数。第一页不传 beforeSeq（后端取最新一页），
 * 之后传上一页返回的 nextBeforeSeq 才能继续往前翻。
 */
function buildHistoryQuery(params) {
  const p = params || {}
  const size = Number(p.pageSize)
  const query = { pageSize: Number.isFinite(size) && size > 0 ? size : HISTORY_PAGE_SIZE }
  const beforeSeq = Number(p.beforeSeq)
  if (Number.isFinite(beforeSeq) && beforeSeq > 0) query.beforeSeq = beforeSeq
  return query
}

/** 会话列表查询参数：sessionStatus 为空表示"全部"，此时不传该字段。 */
function buildSessionListQuery(params) {
  const p = params || {}
  const query = {
    pageNum: Number(p.pageNum) > 0 ? Number(p.pageNum) : 1,
    pageSize: Number(p.pageSize) > 0 ? Number(p.pageSize) : HISTORY_PAGE_SIZE
  }
  const status = normalizeStatus(p.sessionStatus)
  if (status !== null) query.sessionStatus = status
  return query
}

/** 置顶会话排在前面；其余保持后端顺序（本来已是"最近消息时间"倒序）。 */
function sortSessions(records) {
  const list = records || []
  return list.slice().sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
}

/** 按 id 去重（翻页期间有新会话写入时，同一条可能出现在两页里）。 */
function dedupeSessions(records) {
  const seen = {}
  const list = []
  ;(records || []).forEach((row) => {
    if (!row || seen[row.id]) return
    seen[row.id] = true
    list.push(row)
  })
  return list
}

module.exports = {
  SESSION_STATUS,
  SESSION_STATUS_TEXT,
  HISTORY_PAGE_SIZE,
  BIZ_REJECTED,
  DEFAULT_TITLE,
  ENDED_NOTICE,
  ARCHIVED_NOTICE,
  parseDateTime,
  formatSessionTime,
  toIdString,
  sessionStatusText,
  canSendInSession,
  sessionGate,
  gateFromError,
  normalizeSessionRow,
  normalizeSessionPage,
  mapHistoryMessage,
  normalizeHistoryPage,
  mergeHistory,
  buildHistoryQuery,
  buildSessionListQuery,
  sortSessions,
  dedupeSessions
}
