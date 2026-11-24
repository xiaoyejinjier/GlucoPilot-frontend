/** 同步样本血糖统计：汇总 + 纯 view 折线（与今日血糖曲线同刻度/配色，避免弹层 canvas 飞位）。 */

const { getGlucoseStatus } = require('./constants')

const DEFAULT_BRAND = '#2770cf'
const STATUS_COLOR = {
  ok: DEFAULT_BRAND,
  warn: '#fa9d3b',
  danger: '#fa5151'
}
/** 绘图区宽高比，用于把斜线段长度换算成宽度百分比。 */
const PLOT_ASPECT = 2.4

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatTimeLabel(value) {
  const text = String(value || '').replace('T', ' ')
  const match = /^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2})/.exec(text)
  if (match) return match[2]
  return text.slice(11, 16) || text.slice(0, 16) || '—'
}

function summarizePoints(points) {
  const values = (points || [])
    .map((p) => toNumber(p && p.glucoseValue))
    .filter((v) => v != null && v > 0 && v < 40)
  if (!values.length) {
    return { count: 0, avg: null, min: null, max: null, avgText: '—', minText: '—', maxText: '—' }
  }
  const sum = values.reduce((a, b) => a + b, 0)
  const avg = sum / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1)
  return {
    count: values.length,
    avg,
    min,
    max,
    avgText: fmt(avg),
    minText: fmt(min),
    maxText: fmt(max)
  }
}

/** 与记录页今日血糖曲线相同的纵轴刻度。 */
function resolveYScale(values) {
  const smallest = values.length ? Math.min(...values) : 3
  const largest = values.length ? Math.max(...values) : 12
  const minY = smallest < 3 ? 0 : 3
  let tickStep = 3
  if (largest > 21) tickStep = 6
  if (largest > 33) tickStep = 9
  const maxY = Math.max(12, minY + Math.ceil((largest - minY) / tickStep) * tickStep)
  const yTicks = []
  for (let value = minY; value <= maxY; value += tickStep) yTicks.push(value)
  return { minY, maxY, yTicks }
}

function emptyLineSeries(brand) {
  return {
    brand: brand || DEFAULT_BRAND,
    unit: 'mmol/L',
    yTicks: [],
    grid: [],
    segments: [],
    points: []
  }
}

/**
 * 生成与今日血糖曲线一致的折线布局（百分比坐标，供 WXML 渲染）。
 * @returns {{ brand: string, unit: string, yTicks: Array, grid: Array, segments: Array, points: Array }}
 */
function buildLineSeries(points, brand) {
  const lineColor = brand || DEFAULT_BRAND
  const colors = { ...STATUS_COLOR, ok: lineColor }
  const series = (points || [])
    .map((p) => ({
      label: formatTimeLabel(p && p.recordedAt),
      value: toNumber(p && p.glucoseValue)
    }))
    .filter((p) => p.value != null && p.value > 0 && p.value < 40)
  if (!series.length) return emptyLineSeries(lineColor)

  const { minY, maxY, yTicks } = resolveYScale(series.map((p) => p.value))
  const span = maxY - minY || 1
  const count = series.length
  const stepX = count > 1 ? 100 / (count - 1) : 0
  const labelStep = Math.max(1, Math.ceil(count / 5))

  const plotted = series.map((p, index) => {
    const left = count > 1 ? index * stepX : 50
    const top = 100 - ((p.value - minY) / span) * 100
    const status = getGlucoseStatus(p.value)
    return {
      left: Number(left.toFixed(2)),
      top: Number(top.toFixed(2)),
      color: colors[status] || lineColor,
      label: p.label,
      valueText: (Math.round(p.value * 10) / 10).toFixed(1),
      showLabel: index % labelStep === 0 || index === count - 1
    }
  })

  const segments = []
  for (let i = 0; i < plotted.length - 1; i += 1) {
    const a = plotted[i]
    const b = plotted[i + 1]
    const dx = ((b.left - a.left) / 100) * PLOT_ASPECT
    const dy = (b.top - a.top) / 100
    const length = Math.sqrt(dx * dx + dy * dy)
    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    segments.push({
      left: a.left,
      top: a.top,
      width: Number(((length / PLOT_ASPECT) * 100).toFixed(2)),
      angle: Number(angle.toFixed(2))
    })
  }

  return {
    brand: lineColor,
    unit: 'mmol/L',
    yTicks: yTicks.map((value) => ({
      label: String(value),
      top: Number((100 - ((value - minY) / span) * 100).toFixed(2))
    })),
    grid: yTicks.map((value) => ({
      top: Number((100 - ((value - minY) / span) * 100).toFixed(2))
    })),
    segments,
    points: plotted
  }
}

/** @deprecated 兼容旧测试名，等同 buildLineSeries(...).points */
function buildBarSeries(points, brand) {
  return buildLineSeries(points, brand).points.map((p) => ({
    label: p.label,
    valueText: p.valueText,
    heightPercent: Math.max(8, Math.round(100 - p.top)),
    color: p.color
  }))
}

module.exports = {
  summarizePoints,
  buildLineSeries,
  buildBarSeries,
  formatTimeLabel,
  resolveYScale
}
