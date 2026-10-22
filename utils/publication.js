const TAGS = [
  { code: 'diet', name: '饮食控糖' }, { code: 'type1', name: '1型糖尿病' },
  { code: 'type2', name: '2型糖尿病' }, { code: 'medication', name: '药物科普' },
  { code: 'exercise', name: '运动管理' }, { code: 'daily', name: '日常管理' }
]
const STATES = {
  AI_PENDING: { label: '等待 AI 初审', tone: 'waiting', step: 1, hint: '文章已提交，初审完成后会进入管理员审核。' },
  AI_REVIEWING: { label: 'AI 初审中', tone: 'waiting', step: 1, hint: '正在检查文章内容，请稍后回来查看。' },
  PENDING_ADMIN: { label: '待管理员终审', tone: 'waiting', step: 2, hint: 'AI 初审已通过，管理员终审通过后按可见范围展示。' },
  PUBLISHED: { label: '已发布', tone: 'success', step: 3, hint: '文章已通过终审，按你设置的可见范围展示。' },
  AI_REJECTED: { label: '初审未通过', tone: 'danger', step: 1, hint: '请根据初审意见修改后重新提交。' },
  AI_ERROR: { label: '初审暂未完成', tone: 'warning', step: 1, hint: '审核服务暂时不可用，可重新提交初审。' },
  REJECTED: { label: '需要修改', tone: 'danger', step: 2, hint: '请根据管理员意见修改后重新提交。' },
  HIDDEN: { label: '已下架', tone: 'muted', step: 3, hint: '文章已停止公开展示，修改后可以重新提交审核。' }
}
function state(value) { return STATES[value] || { label: '状态待更新', tone: 'muted', step: 0, hint: '请刷新查看最新状态。' } }
function normalizeTag(value) { return String(value || '').normalize('NFKC').replace(/^\s*#+/, '').trim().replace(/\s+/g, ' ') }
function tagIssue(value) { const name = normalizeTag(value); return /^[\p{L}\p{N} _-]{1,16}$/u.test(name) ? '' : '标签限1～16字，可用中文、字母和数字' }
function validate(title, body, codes, customTags = [], mediaCount = 0) {
  if (!String(title || '').trim()) return '请先填写文章标题'
  if (String(title).trim().length > 80) return '标题最多80字'
  if (!mediaCount && String(body || '').trim().length < 20) return '正文至少20字，分享得详细一些吧'
  if (String(body).length > 8000) return '正文最多8000字'
  if (!Array.isArray(codes) || !Array.isArray(customTags) || codes.length + customTags.length < 1 || codes.length + customTags.length > 3) return '请选择或填写1～3个文章标签'
  if (customTags.some(name => tagIssue(name))) return '标签限1～16字，可用中文、字母和数字'
  return ''
}
function reportUrl(type, id) { return /^[1-9]\d{0,18}$/.test(String(id || '')) && ['ARTICLE','COMMENT','USER','MESSAGE'].includes(type) ? `/pages/community-report/community-report?type=${type}&id=${id}` : '' }
module.exports = { TAGS, STATES, state, validate, reportUrl, normalizeTag, tagIssue }
