const { GLUCOSE_NODES } = require('./constants')
const LOW_THRESHOLD = 3.9
const HIGH_THRESHOLD = 10

/** 独立提醒口径；仅消费原页面已读取的实测节点，不更改节点或缓存。 */
function buildGlucoseAlerts(nodes) {
  const known = GLUCOSE_NODES.filter((node) => !node.isMeal)
  return (Array.isArray(nodes) ? nodes : []).filter((node) => node && !node.isMeal && node.hasRecord
    && known.some((item) => item.id === node.id)
    && (typeof node.value === 'number' || (typeof node.value === 'string' && node.value.trim())))
    .map((node) => ({ node, value: Number(node.value) }))
    .filter(({ value }) => Number.isFinite(value) && value > 0 && value < 40 && (value < LOW_THRESHOLD || value >= HIGH_THRESHOLD))
    .map(({ node, value }) => ({
      id: node.id,
      name: known.find((item) => item.id === node.id).name,
      value: String(value),
      type: value < LOW_THRESHOLD ? 'low' : 'high',
      label: value < LOW_THRESHOLD ? '低值提醒' : '高值提醒'
    }))
}

module.exports = { buildGlucoseAlerts, LOW_THRESHOLD, HIGH_THRESHOLD }
