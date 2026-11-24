const test = require('node:test')
const assert = require('node:assert/strict')
const {
  summarizePoints,
  formatTimeLabel,
  buildLineSeries,
  resolveYScale
} = require('../../utils/sync-sample-chart')

test('summarizePoints 计算均值最低最高', () => {
  const stats = summarizePoints([
    { glucoseValue: 5.6 },
    { glucoseValue: '7.2' },
    { glucoseValue: null },
    { glucoseValue: 6.0 }
  ])
  assert.equal(stats.count, 3)
  assert.equal(stats.minText, '5.6')
  assert.equal(stats.maxText, '7.2')
  assert.equal(stats.avgText, '6.3')
})

test('summarizePoints 空样本返回占位', () => {
  const stats = summarizePoints([])
  assert.equal(stats.count, 0)
  assert.equal(stats.avgText, '—')
})

test('formatTimeLabel 截取时分', () => {
  assert.equal(formatTimeLabel('2026-11-24T08:15:30'), '08:15')
  assert.equal(formatTimeLabel('2026-11-24 09:00:00'), '09:00')
})

test('resolveYScale 与今日血糖曲线同刻度', () => {
  const scale = resolveYScale([5.6, 8.2, 11])
  assert.equal(scale.minY, 3)
  assert.equal(scale.maxY, 12)
  assert.deepEqual(scale.yTicks, [3, 6, 9, 12])
})

test('buildLineSeries 生成折线点段与达标色', () => {
  const chart = buildLineSeries(
    [
      { recordedAt: '2026-11-24T08:00:00', glucoseValue: 5.6 },
      { recordedAt: '2026-11-24T09:00:00', glucoseValue: 8.2 },
      { recordedAt: '2026-11-24T10:00:00', glucoseValue: 11.0 }
    ],
    '#2770cf'
  )
  assert.equal(chart.brand, '#2770cf')
  assert.equal(chart.unit, 'mmol/L')
  assert.equal(chart.points.length, 3)
  assert.equal(chart.segments.length, 2)
  assert.equal(chart.points[0].label, '08:00')
  assert.equal(chart.points[0].color, '#2770cf')
  assert.equal(chart.points[1].color, '#fa9d3b')
  assert.equal(chart.points[2].color, '#fa5151')
  assert.ok(chart.points[2].top < chart.points[0].top)
  assert.equal(chart.yTicks[0].label, '3')
  assert.equal(chart.yTicks.at(-1).label, '12')
})

test('buildLineSeries 空样本返回空布局', () => {
  const chart = buildLineSeries([])
  assert.equal(chart.points.length, 0)
  assert.equal(chart.segments.length, 0)
  assert.equal(chart.unit, 'mmol/L')
})
