const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const dates = require('../../utils/stats-week')
const { GLUCOSE_NODES } = require('../../utils/constants')

const directory = path.resolve(__dirname, '../../pages/stats')
const source = fs.readFileSync(path.join(directory, 'stats.js'), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))

function summaryFor(query, value = 6.5) {
  return { monthRecordDays: 3, monthTotal: 12, compliance: 10, calendarMap: {}, slotStats: [],
    week: { startDate: query.startDate, endDate: query.endDate, avg: value, max: value + 1, min: value - 1,
      points: [{ label: '一', value }] } }
}

function createPage(fetch, wxOverrides = {}) {
  let definition
  const calls = { queries: [], draw: 0, updates: 0, dayQueries: [] }
  const dependencies = {
    '../../utils/locales/en': require('../../utils/locales/en'),
    '../../services/api': {
      fetchGlucoseSummary: async (query) => {
        calls.queries.push({ ...query })
        return fetch ? fetch(query, calls.queries.length) : summaryFor(query)
      },
      fetchGlucoseRecords: async (query) => { calls.dayQueries.push(query); return { records: [] } },
      fetchDayMeals: async () => ({ meals: [] })
    },
    '../../utils/constants': { GLUCOSE_NODES },
    '../../utils/stats-week': dates,
    '../../utils/meal-details': require('../../utils/meal-details'),
    '../../utils/glucose-chart': require('../../utils/glucose-chart'),
    '../../utils/display': { applyDisplayToCurrentPage() {}, getTheme: () => ({ brand: '#07c160' }), getDisplaySettings: () => ({}) }
  }
  vm.runInNewContext(source, {
    Page: (page) => { definition = page },
    require: (name) => {
      if (!dependencies[name]) throw new Error('Unexpected import: ' + name)
      return dependencies[name]
    },
    wx: { showToast() {}, navigateTo() {}, switchTab() {}, nextTick: (callback) => callback(), ...wxOverrides },
    setTimeout, clearTimeout
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (values, callback) { calls.updates++; Object.assign(this.data, values); if (callback) callback() }
  page.drawWeekChart = () => { calls.draw++ }
  page.setData({ year: 2026, month: 10, selectedDay: 14, activeView: 'glucose' })
  return { page, calls, rawDrawWeekChart: definition.drawWeekChart }
}

function pickWeek(page, startDate) {
  page.onOpenWeekPicker()
  return page.onSelectWeek({ currentTarget: { dataset: { start: startDate } } })
}

test('自然周以周一开始，周日也属于前六天所在周', () => {
  for (const day of [12, 14, 18]) {
    assert.deepEqual(dates.getNaturalWeek(2026, 10, day), { startDate: '2026-10-12', endDate: '2026-10-18' })
  }
})

test('月周列表覆盖完整首尾周，正确处理4/5/6周、闰年与跨年', () => {
  const october = dates.getMonthWeeks(2026, 10, '2026-10-12')
  assert.equal(october.length, 5)
  assert.equal(october[0].startDate, '2026-09-28')
  assert.equal(october.at(-1).endDate, '2026-11-01')
  assert.equal(october.filter((week) => week.selected).length, 1)
  assert.equal(dates.getMonthWeeks(2021, 2).length, 4)
  assert.equal(dates.getMonthWeeks(2024, 2).length, 5)
  assert.equal(dates.getMonthWeeks(2020, 8).length, 6)
  const january = dates.getMonthWeeks(2026, 1)
  assert.equal(january[0].startDate, '2025-12-29')
  assert.equal(january[0].endDate, '2026-01-04')
  assert.match(january[0].label, /2025.*2026/)
})

test('本地日期解析拒绝无效日期且保留合法闰日', () => {
  assert.equal(dates.parseLocalDate('2026-02-29'), null)
  assert.equal(dates.parseLocalDate('2026-13-01'), null)
  assert.equal(dates.parseLocalDate('invalid'), null)
  assert.equal(dates.formatLocalDate(dates.parseLocalDate('2024-02-29')), '2024-02-29')
})

test('默认周跟随月视图选中日期，周摘要与曲线一起刷新', async () => {
  const { page, calls } = createPage()
  await page.loadSummary()
  assert.deepEqual(calls.queries[0], { year: 2026, month: 10, startDate: '2026-10-12', endDate: '2026-10-18' })
  assert.equal(page.data.weekAvg, '6.5')
  assert.equal(page.data.weekPoints[0].value, 6.5)
  assert.equal(page.data.weekRangeText, '2026.10.12–10.18')
  assert.equal(calls.draw, 1)
})

test('弹窗切月份/年月和取消不触发查询或改动日历/所选周', async () => {
  const { page, calls } = createPage()
  await page.loadSummary()
  page.onOpenWeekPicker()
  assert.equal(page.data.weekPickerOptions.find((week) => week.selected).startDate, '2026-10-12')
  page.onPrevWeekPickerMonth()
  assert.equal(page.data.weekPickerMonth, 9)
  page.onNextWeekPickerMonth()
  page.onWeekPickerMonthChange({ detail: { value: '2025-12' } })
  assert.equal(page.data.weekPickerYear, 2025)
  assert.equal(page.data.weekPickerMonth, 12)
  page.onCloseWeekPicker()
  assert.equal(calls.queries.length, 1)
  assert.equal(page.data.year, 2026)
  assert.equal(page.data.month, 10)
  assert.equal(page.data.selectedDay, 14)
  assert.equal(page.data.weekAnchorDate, '')
})

test('手动选其他年份跨年周，仅覆盖周参数，月统计和日历保持原月份', async () => {
  const { page, calls } = createPage()
  await page.loadSummary()
  page.onOpenWeekPicker()
  page.onWeekPickerMonthChange({ detail: { value: '2026-01' } })
  await page.onSelectWeek({ currentTarget: { dataset: { start: '2025-12-29' } } })
  assert.deepEqual(calls.queries.at(-1), { year: 2026, month: 10, startDate: '2025-12-29', endDate: '2026-01-04' })
  assert.equal(page.data.month, 10)
  assert.equal(page.data.selectedDay, 14)
  assert.equal(page.data.monthTotal, 12)
  assert.equal(page.data.showWeekPicker, false)
  assert.equal(page.data.weekAnchorDate, '2025-12-29')
  assert.match(page.data.weekRangeText, /2025.*2026/)
})

test('切换血糖/日历视图保留手动周，日历日期改变后恢复跟随', async () => {
  const { page, calls } = createPage()
  await pickWeek(page, '2026-10-05')
  page.onSwitchToCalendar()
  page.onSwitchToGlucose()
  assert.equal(page.data.weekAnchorDate, '2026-10-05')
  page.onDayTap({ currentTarget: { dataset: { day: 20 } } })
  await flush()
  assert.equal(page.data.weekAnchorDate, '')
  assert.equal(page.data.selectedDay, 20)
  assert.equal(calls.queries.at(-1).startDate, '2026-10-19')
})

test('日历上下月/上下日操作均清除手动周覆盖', async () => {
  for (const method of ['onPrevMonth', 'onNextMonth', 'onPrevDay', 'onNextDay']) {
    const { page, calls } = createPage()
    await pickWeek(page, '2026-10-05')
    await page[method]()
    await flush()
    assert.equal(page.data.weekAnchorDate, '')
    const expected = dates.getNaturalWeek(page.data.year, page.data.month, page.data.selectedDay)
    assert.equal(calls.queries.at(-1).startDate, expected.startDate)
    assert.equal(calls.queries.at(-1).endDate, expected.endDate)
  }
})

test('跟随日历按钮恢复原日期所在周，重复选同一周不重复请求', async () => {
  const { page, calls } = createPage()
  await page.loadSummary()
  await pickWeek(page, '2026-10-12')
  assert.equal(calls.queries.length, 1)
  await pickWeek(page, '2026-10-05')
  await page.onFollowCalendarWeek()
  assert.equal(calls.queries.length, 3)
  assert.equal(page.data.weekAnchorDate, '')
  assert.equal(calls.queries.at(-1).startDate, '2026-10-12')
})

test('快速选周时晚返回的旧请求不能覆盖最新周', async () => {
  const pending = []
  const { page } = createPage((query) => new Promise((resolve) => pending.push({ query, resolve })))
  const initial = page.loadSummary()
  const next = pickWeek(page, '2026-10-05')
  pending[1].resolve(summaryFor(pending[1].query, 7.2))
  await next
  pending[0].resolve(summaryFor(pending[0].query, 9.9))
  await initial
  assert.equal(page.data.weekAvg, '7.2')
  assert.equal(page.data.weekPoints[0].value, 7.2)
  assert.equal(page.data.weekRangeText, '2026.10.05–10.11')
})

test('切周失败清除旧曲线和摘要并支持原周重试，不显示错周结果', async () => {
  const { page, calls } = createPage((query, attempt) => {
    if (attempt === 2) throw new Error('网络不可用')
    return summaryFor(query)
  })
  await page.loadSummary()
  await pickWeek(page, '2026-10-05')
  assert.equal(page.data.weekLoadFailed, true)
  assert.equal(page.data.weekPoints.length, 0)
  assert.equal(page.data.weekAvg, '--')
  assert.equal(page.data.loading, false)
  const previousDraws = calls.draw
  page.scheduleWeekChart()
  assert.equal(calls.draw, previousDraws)
  await page.onRetryWeek()
  assert.equal(page.data.weekLoadFailed, false)
  assert.equal(page.data.weekAvg, '6.5')
  assert.equal(calls.queries.at(-1).startDate, '2026-10-05')
})

test('已失效的setData布局回调不能重建旧日历或触发旧图表', async () => {
  const { page, calls } = createPage()
  const callbacks = []
  const setData = page.setData
  page.setData = function (values, callback) {
    setData.call(this, values)
    if (callback) callbacks.push(callback)
  }
  await page.loadSummary()
  await pickWeek(page, '2026-10-05')
  callbacks[0]()
  assert.equal(calls.draw, 0)
  assert.equal(page.data.calendarDays.length, 0)
  callbacks.at(-1)()
  assert.equal(calls.draw, 1)
  assert.ok(page.data.calendarDays.length > 0)
})

test('隐藏/退出页面后统计异步响应不回写页面', async () => {
  for (const action of ['onHide', 'onUnload']) {
    let resolve
    const { page, calls } = createPage((query) => new Promise((done) => { resolve = () => done(summaryFor(query)) }))
    const request = page.loadSummary()
    page[action]()
    const updates = calls.updates
    resolve()
    await request
    assert.equal(calls.updates, updates)
  }
})

test('无效月份或任意日期不能绕过弹窗选项，选择范围边界不越界', async () => {
  const { page, calls } = createPage()
  await page.loadSummary()
  page.onOpenWeekPicker()
  for (const value of ['invalid', '2026-13', '1969-12', '2100-01']) page.onWeekPickerMonthChange({ detail: { value } })
  assert.equal(page.data.weekPickerMonth, 10)
  page.onSelectWeek({ currentTarget: { dataset: { start: '2026-10-06' } } })
  assert.equal(calls.queries.length, 1)
  page.updateWeekPickerMonth(1970, 1)
  page.onPrevWeekPickerMonth()
  assert.equal(page.data.weekPickerYear, 1970)
  assert.equal(page.data.weekPickerMonth, 1)
})

test('模板包含点击周范围、整周选项、年月跳转及错误重试的有效事件', () => {
  const template = fs.readFileSync(path.join(directory, 'stats.wxml'), 'utf8')
  const { page } = createPage()
  for (const [, handler] of template.matchAll(/(?:bindtap|bindchange|catchtap|catchtouchmove)="(\w+)"/g)) {
    assert.equal(typeof page[handler], 'function', handler)
  }
  assert.match(template, /bindtap="onOpenWeekPicker"/)
  assert.match(template, /fields="month"/)
  assert.match(template, /wx:key="startDate"/)
  assert.match(template, /bindtap="onFollowCalendarWeek"/)
  assert.match(template, /bindtap="onRetryWeek"/)
})

test('打开弹窗取消旧绘制，弹窗期间刷新/缩放不绘制，关闭后恢复图表', async () => {
  let queries = 0
  const { page, calls, rawDrawWeekChart } = createPage(undefined, {
    createSelectorQuery: () => { queries++; throw new Error('弹窗期间不应查询Canvas') }
  })
  await page.loadSummary()
  const previousVersion = page._chartDrawVersion
  const previousDraws = calls.draw
  page.onOpenWeekPicker()
  assert.ok(page._chartDrawVersion > previousVersion)
  page.scheduleWeekChart()
  page.onResize()
  rawDrawWeekChart.call(page, page._chartDrawVersion, 0)
  assert.equal(calls.draw, previousDraws)
  assert.equal(queries, 0)
  page.onCloseWeekPicker()
  assert.equal(page.data.showWeekPicker, false)
  assert.equal(calls.draw, previousDraws + 1)
})

test('选中当前周或跟随同一日历周，关闭后重新绘图但不重新请求数据', async () => {
  for (const action of ['current-week', 'follow-calendar']) {
    const { page, calls } = createPage()
    await page.loadSummary()
    page.onOpenWeekPicker()
    const previousDraws = calls.draw
    if (action === 'current-week') await page.onSelectWeek({ currentTarget: { dataset: { start: '2026-10-12' } } })
    else await page.onFollowCalendarWeek()
    assert.equal(page.data.showWeekPicker, false)
    assert.equal(calls.draw, previousDraws + 1)
    assert.equal(calls.queries.length, 1)
  }
})

test('弹窗打开时返回的统计数据不触发Canvas绘制，关闭再绘制新数据', async () => {
  let resolve
  const { page, calls } = createPage((query) => new Promise((done) => { resolve = () => done(summaryFor(query, 7.8)) }))
  const request = page.loadSummary()
  page.onOpenWeekPicker()
  resolve()
  await request
  assert.equal(calls.draw, 0)
  assert.equal(page.data.weekAvg, '7.8')
  page.onCloseWeekPicker()
  assert.equal(calls.draw, 1)
  assert.equal(page.data.weekPoints[0].value, 7.8)
})

test('弹窗打开前发出的Canvas查询，晚回调时不得重试或操作原生图层', async () => {
  let canvasCallback
  const { page, rawDrawWeekChart } = createPage(undefined, {
    createSelectorQuery: () => ({
      select() { return this }, fields() { return this },
      exec(callback) { canvasCallback = callback }
    })
  })
  await page.loadSummary()
  rawDrawWeekChart.call(page, page._chartDrawVersion, 0)
  assert.equal(typeof canvasCallback, 'function')
  page.onOpenWeekPicker()
  canvasCallback([])
  assert.ok(!page._chartDrawTimer)
  assert.equal(page.data.weekChartError, false)
})

test('弹窗期间用等高普通view替代Canvas，不仅依赖CSS层级遮盖', () => {
  const template = fs.readFileSync(path.join(directory, 'stats.wxml'), 'utf8')
  assert.match(template, /<view wx:if="\{\{showWeekPicker\}\}" class="chart-canvas"><\/view>\s*<canvas wx:else type="2d" id="weekChart" class="chart-canvas">/)
})

function renderWeek(points) {
  const operations = []
  const context = new Proxy({}, {
    get: (_, method) => (...args) => operations.push({ method, args }),
    set: (_, name, value) => { operations.push({ method: 'style', args: [name, value] }); return true }
  })
  const { page, rawDrawWeekChart } = createPage(undefined, {
    getWindowInfo: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => ({
      select() { return this }, fields() { return this },
      exec(callback) { callback([{ node: { getContext: () => context }, width: 320, height: 150 }]) }
    })
  })
  page._chartDrawVersion = 1
  page.setData({ weekPoints: points, loading: false, weekLoadFailed: false })
  rawDrawWeekChart.call(page, 1, 0)
  return operations
}

test('周图分别连接预测和实测并保留缺日横轴，预测先画虚线白点、实测最后画实线', () => {
  const points = Array.from({ length: 7 }, (_, index) => ({ label: String(index), value: null, predictedValue: null }))
  points[0] = { ...points[0], value: 6, predictedValue: 14 }
  points[6] = { ...points[6], value: 8, predictedValue: 7 }
  const operations = renderWeek(points)
  const dashed = operations.findIndex((op) => op.method === 'setLineDash' && op.args[0].length)
  const solid = operations.findIndex((op, i) => i > dashed && op.method === 'setLineDash' && !op.args[0].length)
  assert.ok(dashed > 0 && solid > dashed)
  const arcs = operations.filter((op) => op.method === 'arc')
  assert.equal(arcs.length, 4)
  assert.deepEqual(arcs.map((op) => op.args[2]), [4, 4, 5, 5])
  assert.equal(arcs[0].args[0], 40)
  assert.equal(arcs[1].args[0], 308)
  assert.ok(arcs.every((op) => op.args[1] >= 16 && op.args[1] <= 122))
  assert.ok(operations.some((op) => op.method === 'fillText' && op.args[0] === '14'))
  assert.ok(operations.slice(solid).some((op) => op.method === 'style' && op.args[0] === 'fillStyle' && op.args[1] === '#fff'))
})

test('只有推荐预测也显示周曲线，不生成实测点；无预测也不填零', () => {
  const predictionOnly = renderWeek([{ label: '一', value: null, predictedValue: 7.1 },
    { label: '二', value: null, predictedValue: null }])
  assert.deepEqual(predictionOnly.filter((op) => op.method === 'arc').map((op) => op.args[2]), [4])
  assert.equal(predictionOnly.some((op) => op.method === 'fillText' && op.args[0] === '本周暂无记录'), false)
  const noData = renderWeek([{ label: '一', value: null, predictedValue: null },
    { label: '二', value: null, predictedValue: 0 }])
  assert.equal(noData.some((op) => op.method === 'arc'), false)
  assert.ok(noData.some((op) => op.method === 'fillText' && op.args[0] === '本周暂无记录'))
})

test('摘要映射保留预测日均值与有效餐数，不覆盖实测日均值和周摘要', () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.resolve(directory, '../../utils/mappers.js'), 'utf8'), {
    module, require: () => ({ getFoodImage: () => '' })
  })
  const result = module.exports.mapSummary({ week: { avg: 6.5, max: 8, min: 5,
    points: [{ avg: 6, count: 2, predictedAvg: 9, predictionCount: 3 },
      { avg: null, count: 0, predictedAvg: null, predictionCount: 0 }] } })
  assert.equal(result.week.points[0].value, 6)
  assert.equal(result.week.points[0].predictedValue, 9)
  assert.equal(result.week.points[0].predictionCount, 3)
  assert.equal(result.week.points[1].predictedValue, null)
  assert.equal(result.week.avg, 6.5)
})
