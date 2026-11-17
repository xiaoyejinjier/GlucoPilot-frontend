const TOPICS = [
  { code: '', name: '全部求助' },
  { code: 'GLUCOSE', name: '血糖波动' },
  { code: 'DIET', name: '饮食咨询' },
  { code: 'MEDICATION', name: '用药疑问' },
  { code: 'CHECKUP', name: '复查解读' }
]
const STATUS = { PREVIEW: '尚未发布', WAITING: '等待医生', IN_PROGRESS: '接诊中', REPLIED: '医生已回复',
  REPORT_READY: '问诊单已出具', CLOSED: '已结束', PENDING: '待支付', PAID: '已支付', REFUNDED: '已退款' }
function identifier(value) { return /^[1-9]\d{0,18}$/.test(String(value || '')) ? String(value) : '' }
function money(cents) {
  const amount = Number(cents)
  return Number.isSafeInteger(amount) && amount >= 0 ? (amount / 100).toFixed(2) : '—'
}
function topicName(code) { return (TOPICS.find(item => item.code === code) || {}).name || '健康咨询' }
function decorate(item) {
  return { ...item, id: String(item.id || ''), topicLabel: topicName(item.topic),
    statusLabel: STATUS[item.status] || '处理中', timeLabel: String(item.createdAt || '').replace('T', ' ').slice(0, 16) }
}
function attemptId() { return `consult_${Date.now()}_${Math.random().toString(36).slice(2, 12)}` }
function preview(form = {}) {
  return { title: form.title || '问诊单预览', topic: form.topic || 'GLUCOSE', status: 'PREVIEW',
    symptoms: form.symptoms || '', glucoseNote: form.glucoseNote || '', medicationNote: form.medicationNote || '',
    anonymous: form.anonymous !== false, report: { access: 'LOCKED', ready: false, feeCents: 100 } }
}
module.exports = { TOPICS, STATUS, identifier, money, topicName, decorate, attemptId, preview }
