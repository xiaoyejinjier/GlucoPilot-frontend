const { getGlucoseStatus } = require('./constants')

const SOURCE_TEXT = { 1: '手动录入', 2: '拍照识别', 3: '设备同步' }

function hasMeasuredGlucose(node) {
  return !!node && !node.isMeal && node.hasRecord !== false && node.value != null && node.value !== ''
    && Number.isFinite(Number(node.value)) && Number(node.value) > 0 && Number(node.value) < 40
}

function formatRecordTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/.exec(String(value || ''))
  return match ? match[1] + ' ' + match[2] + (match[3] || '') : '时间未提供'
}

function getPointDetails(node) {
  if (!hasMeasuredGlucose(node)) return null
  return { nodeId: node.id, nodeName: node.name, value: Number(node.value), status: getGlucoseStatus(node.value),
    recordedAtText: formatRecordTime(node.recordedAt),
    sourceText: SOURCE_TEXT[node.sourceType] || '来源未提供', remark: node.remark || '' }
}

/** CanvasTouch的x/y是Canvas本地逻辑像素，不乘DPR；client坐标须减去当前视口矩形。 */
function getTouchPosition(touch, rect, size) {
  if (!touch) return null
  if (Number.isFinite(touch.x) && Number.isFinite(touch.y)) return { x: touch.x, y: touch.y }
  if (!rect || !size || !rect.width || !rect.height
    || !Number.isFinite(touch.clientX) || !Number.isFinite(touch.clientY)) return null
  return { x: (touch.clientX - rect.left) * size.width / rect.width,
    y: (touch.clientY - rect.top) * size.height / rect.height }
}

function findChartPoint(points, position, radius = 20) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  let selected = null
  let distance = radius * radius
  for (const point of points || []) {
    const squared = (point.x - position.x) ** 2 + (point.y - position.y) ** 2
    if (Number.isFinite(squared) && squared <= distance) { selected = point; distance = squared }
  }
  return selected
}

module.exports = { hasMeasuredGlucose, getPointDetails, getTouchPosition, findChartPoint, formatRecordTime }
