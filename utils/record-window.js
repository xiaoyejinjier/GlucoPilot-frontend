/**
 * 九时段的前端可选时间规则。
 *
 * 早餐前/早餐在 10:00 截止，早餐后/午餐前/午餐在 14:00 截止，
 * 午餐后/晚餐前/晚餐在 20:00 截止；晚餐后不设日内截止。
 */
const NODE_CUTOFFS = {
  before_breakfast: {
    cutoffMinutes: 10 * 60,
    cutoffText: '10:00',
    groupName: '早餐前和早餐',
    nextNodeName: '早餐后'
  },
  breakfast: {
    cutoffMinutes: 10 * 60,
    cutoffText: '10:00',
    groupName: '早餐前和早餐',
    nextNodeName: '早餐后'
  },
  after_breakfast: {
    cutoffMinutes: 14 * 60,
    cutoffText: '14:00',
    groupName: '早餐后',
    nextNodeName: '午餐后'
  },
  before_lunch: {
    cutoffMinutes: 14 * 60,
    cutoffText: '14:00',
    groupName: '午餐前和午餐',
    nextNodeName: '午餐后'
  },
  lunch: {
    cutoffMinutes: 14 * 60,
    cutoffText: '14:00',
    groupName: '午餐前和午餐',
    nextNodeName: '午餐后'
  },
  after_lunch: {
    cutoffMinutes: 20 * 60,
    cutoffText: '20:00',
    groupName: '午餐后',
    nextNodeName: '晚餐后'
  },
  before_dinner: {
    cutoffMinutes: 20 * 60,
    cutoffText: '20:00',
    groupName: '晚餐前和晚餐',
    nextNodeName: '晚餐后'
  },
  dinner: {
    cutoffMinutes: 20 * 60,
    cutoffText: '20:00',
    groupName: '晚餐前和晚餐',
    nextNodeName: '晚餐后'
  }
}

function minutesOfDay(now) {
  const date = now instanceof Date ? now : new Date()
  return date.getHours() * 60 + date.getMinutes()
}

function getNodeRecordWindow(nodeId, now) {
  const rule = NODE_CUTOFFS[nodeId]
  if (!rule) {
    return {
      locked: false,
      cutoffText: '',
      lockReason: ''
    }
  }

  const locked = minutesOfDay(now) >= rule.cutoffMinutes
  return {
    locked,
    cutoffText: rule.cutoffText,
    lockReason: locked
      ? `${rule.groupName}仅可在 ${rule.cutoffText} 前记录。现在可以选择${rule.nextNodeName}或后续时段。`
      : `${rule.cutoffText} 前可记录`
  }
}

function getRecordWindowHint(now) {
  const minutes = minutesOfDay(now)
  if (minutes < 10 * 60) return '早餐前、早餐可记录至 10:00；早餐后可记录至 14:00'
  if (minutes < 14 * 60) return '早餐前和早餐已截止；早餐后、午餐前和午餐可记录至 14:00'
  if (minutes < 20 * 60) return '14:00 前的时段已截止；午餐后、晚餐前和晚餐可记录至 20:00'
  return '除晚餐后外，其余八个时段已截止；晚餐后仍可记录'
}

module.exports = {
  NODE_CUTOFFS,
  getNodeRecordWindow,
  getRecordWindowHint
}
