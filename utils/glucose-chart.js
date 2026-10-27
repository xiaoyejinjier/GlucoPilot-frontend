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

const PREDICTION_COLOR = '#47976d'

function getRecommendedPrediction(node) {
  if (!node || !node.isMeal || node.hasRecord === false
    || node.predictionValue == null || node.predictionValue === '') return null
  const value = Number(node.predictionValue)
  return Number.isFinite(value) && value > 0 && value < 40 ? value : null
}

function getChartPointDetails(node) {
  const actual = getPointDetails(node)
  if (actual) return actual
  const value = getRecommendedPrediction(node)
  return value == null ? null : { nodeId: node.id, nodeName: node.name + '后预测', value,
    status: 'prediction', isPrediction: true, sourceText: '按推荐吃法',
    remark: '预测仅供参考，不计入实测记录' }
}

/** 先画预测，再画实测；虚线必须重置，避免影响后续实测和坐标轴。 */
function drawPredictionSeries(ctx, points, segments = [points]) {
  ctx.strokeStyle = PREDICTION_COLOR
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  const lines = segments.filter((segment) => segment.length > 1)
  if (lines.length) {
    ctx.beginPath()
    lines.forEach((segment) => {
      segment.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y)
        else ctx.lineTo(point.x, point.y)
      })
    })
    ctx.stroke()
  }
  ctx.setLineDash([])
  points.forEach((point) => {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.stroke()
  })
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

module.exports = { hasMeasuredGlucose, getPointDetails, getTouchPosition, findChartPoint, formatRecordTime,
  getRecommendedPrediction, getChartPointDetails, drawPredictionSeries, PREDICTION_COLOR }
