const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const chart = require('../../utils/glucose-chart')
const { GLUCOSE_NODES, getGlucoseStatus } = require('../../utils/constants')
const directory = path.resolve(__dirname, '../../pages/ai')
const source = fs.readFileSync(path.join(directory, 'ai.js'), 'utf8')

function createPage(options = {}) {
  let definition
  const state = { date: '2026-10-14', token: 'test-token', records: options.records || {},
    rect: { left: 20, top: 150, width: 320, height: 120 } }
  const calls = { canvas: [], toasts: [], writes: [], recordsQuery: [], drawCallbacks: [], touchCallbacks: [], updates: 0 }
  const ctx = new Proxy({}, { get: (_, method) => (...args) => calls.canvas.push({ method, args }),
    set: (_, method, value) => { calls.canvas.push({ method: 'style', args: [method, value] }); return true } })
  const canvas = { getContext: () => ctx }
  const dependencies = {
    '../../utils/locales/en': require('../../utils/locales/en'),
    '../../utils/constants': { GLUCOSE_NODES, getGlucoseStatus }, '../../utils/glucose-chart': chart,
    '../../services/api': {
      fetchDayBoard: async () => options.board ? options.board() : { nodes: [] },
      fetchDayMeals: async () => options.meals ? options.meals() : { meals: [] },
      fetchGlucoseRecords: async (query) => {
        calls.recordsQuery.push(query)
        return options.glucose ? options.glucose() : { records: [] }
      }
    },
    '../../utils/request': { getToken: () => state.token },
    '../../utils/storage': {
      getTodayKey: () => state.date, getRecords: () => state.records,
      getRecordCount: (records) => Object.keys(records).length,
      replaceDayRecords: (date, records) => { state.records = records; calls.writes.push({ date, records }) }
    },
    '../../utils/display': { applyDisplayToCurrentPage() {}, getTheme: () => ({ brand: '#07c160' }), getDisplaySettings: () => ({}) },
    '../../utils/record-window': { getNodeRecordWindow: () => ({ locked: true }), getRecordWindowHint: () => '' }
  }
  vm.runInNewContext(source, {
    getApp: () => ({ getNavigationGuideToken: () => options.guideToken || '' }),
    Page: (value) => { definition = value }, require: (name) => {
      if (!dependencies[name]) throw new Error(name)
      return dependencies[name]
    },
    wx: {
      nextTick: (callback) => callback(), getWindowInfo: () => ({ pixelRatio: options.dpr || 3 }),
      showToast: (payload) => calls.toasts.push(payload),
      createSelectorQuery: () => ({
        in() { return this }, select() { return this }, fields() { this.kind = 'draw'; return this },
        boundingClientRect() { this.kind = 'touch'; return this },
        exec(callback) {
          if (this.kind === 'touch') {
            if (options.deferTouch) calls.touchCallbacks.push(callback)
            else callback([state.rect])
          } else {
            const run = () => callback([{ node: canvas, width: state.rect.width, height: state.rect.height }])
            if (options.deferDraw) calls.drawCallbacks.push(run)
            else run()
          }
        }
      })
    },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
    console: { warn() {} }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (values, callback) { calls.updates++; Object.assign(this.data, values); if (callback) callback() }
  page._visible = true
  page.loadData()
  const render = () => page.drawChart(page.data.nodes)
  return { page, calls, state, canvas, render }
}

function measured(value = 6.2, extra = {}) {
  return { value, type: 'glucose', sourceType: 2, recordedAt: '2026-10-14T07:12:34.123456', remark: '早餐前记录', ...extra }
}

function tap(page, touch) {
  page.onChartTouchStart({ touches: [touch] })
  page.onChartTouchEnd({ changedTouches: [touch] })
}

test('提醒弹窗移除原生Canvas且取消旧绘图和触摸，关闭后按最新节点恢复', () => {
  const { page, calls, render } = createPage({ records: { before_breakfast: measured() }, deferDraw: true })
  render()
  const oldDraw = calls.drawCallbacks[0]
  page._chartTouch = { position: { x: 1, y: 1 }, moved: false }
  page.onReminderVisibilityChange({ detail: { visible: true } })
  assert.equal(page.data.noticeVisible, true)
  assert.equal(page._chartGeometry, null)
  assert.equal(page._chartTouch, null)
  oldDraw()
  assert.equal(calls.canvas.length, 0)
  const queries = calls.drawCallbacks.length
  page.scheduleChartDraw(page.data.nodes)
  render()
  assert.equal(calls.drawCallbacks.length, queries)
  page.onReminderVisibilityChange({ detail: { visible: false } })
  assert.equal(page.data.noticeVisible, false)
  assert.equal(page._pendingChartNodes, page.data.nodes)
  render()
  calls.drawCallbacks.at(-1)()
  assert.ok(page._chartGeometry)
  const template = fs.readFileSync(path.join(directory, 'ai.wxml'), 'utf8')
  assert.ok(template.includes('bind:visibilitychange="onReminderVisibilityChange"'))
  assert.ok(template.includes('<view wx:if="{{noticeVisible || navigationGuideVisible}}" class="chart-canvas"></view>'))
  assert.ok(template.includes('<canvas wx:else'))
})

test('首次进入引导期间Canvas不穿透，完成后恢复绘图且提醒弹窗仍可独立阻止绘制', () => {
  const { page, calls, render } = createPage({ guideToken: 'test-token', records: { before_breakfast: measured() }, deferDraw: true })
  render()
  const oldDraw = calls.drawCallbacks[0]
  let guideRefreshes = 0
  page.getTabBar = () => ({ setData() {}, refreshGuide() { guideRefreshes++ } })
  page.syncTodayFromServer = page.startRecordWindowTimer = () => {}
  page.onShow()
  assert.equal(guideRefreshes, 1)
  assert.equal(page.data.navigationGuideVisible, true)
  oldDraw()
  page.scheduleChartDraw(page.data.nodes)
  render()
  assert.equal(calls.canvas.length, 0)
  assert.equal(calls.drawCallbacks.length, 1)
  page.onNavigationGuideComplete()
  assert.equal(page.data.navigationGuideVisible, false)
  assert.equal(page._pendingChartNodes, page.data.nodes)
  render()
  calls.drawCallbacks.at(-1)()
  assert.ok(page._chartGeometry)
  page.onReminderVisibilityChange({ detail: { visible: true } })
  const queries = calls.drawCallbacks.length
  page.onNavigationGuideComplete()
  render()
  assert.equal(calls.drawCallbacks.length, queries)
})

test('隐藏页面后关闭提醒弹窗不会重启绘图，原选中数据不因弹窗丢失', () => {
  const { page, render, calls } = createPage({ records: { before_breakfast: measured() } })
  render()
  tap(page, page._chartGeometry.points[0])
  const selected = page.data.chartSelection
  page.onReminderVisibilityChange({ detail: { visible: true } })
  page.onHide()
  page.onReminderVisibilityChange({ detail: { visible: false } })
  assert.equal(page.data.chartSelection, selected)
  assert.equal(page._chartDrawTimer, null)
  assert.equal(calls.writes.length, 0)
})

test('只允许有效实测血糖，正餐预测、空值、未记录和非法值不能绘为血糖', () => {
  assert.equal(chart.hasMeasuredGlucose({ value: 6, hasRecord: true }), true)
  for (const node of [{ value: 6, isMeal: true }, { value: 6, hasRecord: false }, { value: null },
    { value: '' }, { value: 'invalid' }, { value: 0 }, { value: -1 }, { value: 40 }]) {
    assert.equal(chart.hasMeasuredGlucose(node), false)
  }
})

test('详情时间去掉T和小数秒，缺失时不伪造当前时间', () => {
  const details = chart.getPointDetails({ id: 'before_breakfast', name: '早餐前', ...measured() })
  assert.equal(details.value, 6.2)
  assert.equal(details.recordedAtText, '2026-10-14 07:12:34')
  assert.equal(details.sourceText, '拍照识别')
  assert.equal(details.remark, '早餐前记录')
  assert.equal(chart.formatRecordTime(null), '时间未提供')
  assert.equal(chart.formatRecordTime('invalid'), '时间未提供')
  assert.equal(chart.getPointDetails({ value: 6, isMeal: true }), null)
})

test('命中判断选择容错范围内最近点，空白不命中', () => {
  const points = [{ x: 42, y: 60, nodeId: 'a' }, { x: 70, y: 60, nodeId: 'b' }]
  assert.equal(chart.findChartPoint(points, { x: 48, y: 66 }).nodeId, 'a')
  assert.equal(chart.findChartPoint(points, { x: 64, y: 63 }).nodeId, 'b')
  assert.equal(chart.findChartPoint(points, { x: 150, y: 100 }), null)
})

test('Canvas本地坐标不乘DPR，client坐标按当前视口矩形换算并支持缩放', () => {
  assert.deepEqual(chart.getTouchPosition({ x: 0, y: 12 }), { x: 0, y: 12 })
  assert.deepEqual(chart.getTouchPosition({ clientX: 110, clientY: 170 },
    { left: 10, top: 50, width: 200, height: 240 }, { width: 400, height: 120 }), { x: 200, y: 60 })
})

test('六个实测横轴及进度排除正餐，推荐预测独立映射到早餐后', () => {
  const { page, canvas, render } = createPage({ records: {
    before_breakfast: measured(), breakfast: { type: 'meal', value: 39, suggestedGlucose: 39 }
  }, dpr: 3 })
  render()
  assert.equal(canvas.width, 960)
  assert.equal(page._chartGeometry.points.length, 6)
  assert.equal(page._chartGeometry.points.filter((point) => point.has).length, 1)
  assert.equal(page._chartGeometry.points.some((point) => point.nodeId === 'breakfast'), false)
  assert.equal(page._chartGeometry.predictionPoints[0].value, 39)
  assert.equal(page._chartGeometry.predictionPoints[0].x, page._chartGeometry.points[1].x)
  assert.equal(page.data.recordCount, 1)
  assert.equal(page.data.glucoseTotalNodes, 6)
})

test('mmol/L画在最高纵轴刻度上方，六刻度曲线仍保留完整九节点录入', () => {
  for (const value of [6.2, 18, 39]) {
    const { calls, render, page } = createPage({ records: { before_breakfast: measured(value) } })
    render()
    const labels = calls.canvas.filter((call) => call.method === 'fillText')
    const unit = labels.find((call) => call.args[0] === 'mmol/L')
    const ticks = labels.filter((call) => /^\d+$/.test(call.args[0]))
    const topTick = ticks.reduce((top, call) => call.args[2] < top.args[2] ? call : top)
    assert.ok(unit)
    assert.ok(unit.args[2] >= 10)
    assert.ok(topTick.args[2] - unit.args[2] >= 10)
    assert.ok(Math.abs(topTick.args[1] - unit.args[1]) <= 6)
    assert.equal(page._chartGeometry.points.length, 6)
  }
  const template = fs.readFileSync(path.join(directory, 'ai.wxml'), 'utf8')
  for (const removed of ['chart-axis-note', 'chart-touch-hint', 'X 轴：9 时段', '点击实心点查看对应记录']) {
    assert.equal(template.includes(removed), false)
  }
  assert.ok(template.includes('wx:for="{{nodes}}"'))
  assert.ok(template.includes('bindtap="onNodeTap"'))
  assert.ok(template.includes('bindtap="onAddDevice"'))
  const styles = fs.readFileSync(path.join(directory, 'ai.wxss'), 'utf8')
  assert.match(styles, /\.chart-canvas\s*\{[^}]*height: 220rpx/)
  assert.match(styles, /\.node\s*\{[^}]*min-height: 140rpx/)
  assert.equal(/overflow:\s*hidden/.test(styles.match(/\.nodes\s*\{[^}]*\}/)[0]), false)
})

test('点击实测点显示真实明细并高亮，截止时段仍可查看且不写入记录', () => {
  const { page, calls, render } = createPage({ records: { before_breakfast: measured() } })
  render()
  const point = page._chartGeometry.points[0]
  tap(page, { x: point.x + 8, y: point.y + 3 })
  assert.equal(page.data.chartSelection.nodeName, '早餐前')
  assert.equal(page.data.chartSelection.value, 6.2)
  assert.equal(page.data.chartSelection.recordedAtText, '2026-10-14 07:12:34')
  render()
  assert.ok(calls.canvas.some((call) => call.method === 'arc' && call.args[2] === 8))
  assert.equal(calls.writes.length, 0)
})

test('缺测位置不伪造实测，点击推荐预测明确展示预测依据', () => {
  const { page, calls, render } = createPage({ records: { breakfast: { type: 'meal', suggestedGlucose: 8 } } })
  render()
  tap(page, page._chartGeometry.points[0])
  assert.equal(page.data.chartSelection, null)
  assert.match(calls.toasts.at(-1).title, /暂无实测血糖/)
  render()
  tap(page, page._chartGeometry.predictionPoints[0])
  assert.equal(page.data.chartSelection.value, 8)
  assert.equal(page.data.chartSelection.isPrediction, true)
  assert.equal(page.data.chartSelection.sourceText, '按推荐吃法')
  assert.equal(page.data.chartSelection.recordedAtText, undefined)
})

test('同一实测点可反复打开/收起，支持Canvas和client坐标，收起同步取消高亮且不写入', () => {
  for (const coordinates of ['local', 'client']) {
    const { page, render, state, calls } = createPage({ records: { before_breakfast: measured() } })
    const tapMeasured = () => {
      render()
      const point = page._chartGeometry.points[0]
      tap(page, coordinates === 'local' ? point : { clientX: state.rect.left + point.x, clientY: state.rect.top + point.y })
    }
    tapMeasured()
    assert.equal(page.data.chartSelection.nodeId, 'before_breakfast')
    state.rect.top = 30
    tapMeasured()
    assert.equal(page.data.chartSelection, null)
    assert.equal(page.data.selectedChartNodeId, '')
    calls.canvas.length = 0
    render()
    assert.equal(calls.canvas.some((call) => call.method === 'arc' && call.args[2] === 8), false)
    tapMeasured()
    assert.equal(page.data.chartSelection.value, 6.2)
    assert.equal(calls.writes.length, 0)
  }
})

test('点击空白或收起取消高亮，连续点选可切换到另一个血糖记录', () => {
  const { page, render } = createPage({ records: { before_breakfast: measured(), after_breakfast: measured(7) } })
  render()
  tap(page, page._chartGeometry.points[0])
  render()
  tap(page, page._chartGeometry.points[1])
  assert.equal(page.data.chartSelection.nodeId, 'after_breakfast')
  render()
  tap(page, { x: 250, y: 5 })
  assert.equal(page.data.chartSelection, null)
  assert.equal(page.data.selectedChartNodeId, '')
  render()
  tap(page, page._chartGeometry.points[0])
  page.onCloseChartDetails()
  assert.equal(page.data.chartSelection, null)
})

test('滚动、移走再移回、多指和取消手势不能误选血糖点', () => {
  for (const action of ['scroll', 'multi', 'cancel']) {
    const { page, render } = createPage({ records: { before_breakfast: measured() } })
    render()
    const point = page._chartGeometry.points[0]
    page.onChartTouchStart({ touches: [point] })
    if (action === 'scroll') page.onChartTouchMove({ touches: [{ x: point.x, y: point.y + 30 }] })
    if (action === 'multi') page.onChartTouchMove({ touches: [point, point] })
    if (action === 'cancel') page.onChartTouchCancel()
    page.onChartTouchEnd({ changedTouches: [point] })
    assert.equal(page.data.chartSelection, null)
  }
})

test('页面滚动后client坐标使用新视口位置，点击仍命中原曲线点', () => {
  const { page, state, render } = createPage({ records: { before_breakfast: measured() } })
  render()
  const point = page._chartGeometry.points[0]
  state.rect.top = 30
  tap(page, { clientX: state.rect.left + point.x, clientY: state.rect.top + point.y })
  assert.equal(page.data.chartSelection.value, 6.2)
})

test('晚返回的触摸矩形查询在离开页面或刷新图表后失效', () => {
  for (const action of ['hide', 'resize']) {
    const { page, calls, state, render } = createPage({ records: { before_breakfast: measured() }, deferTouch: true })
    render()
    const point = page._chartGeometry.points[0]
    tap(page, { clientX: state.rect.left + point.x, clientY: state.rect.top + point.y })
    if (action === 'hide') page.onHide()
    else page.onResize()
    calls.touchCallbacks[0]([state.rect])
    assert.equal(page.data.chartSelection, null)
  }
})

test('Canvas测量回调在页面隐藏后不重新绘制原生图层', () => {
  const { page, calls, render } = createPage({ records: { before_breakfast: measured() }, deferDraw: true })
  render()
  page.onHide()
  calls.drawCallbacks[0]()
  assert.equal(calls.canvas.length, 0)
  assert.equal(page._chartGeometry, null)
})

test('完整血糖接口优先于日看板，缓存保留真实时间和来源', async () => {
  const { page, calls } = createPage({ board: () => ({ nodes: [{ nodeCode: 'before_breakfast', hasRecord: true, value: 9 }] }),
    glucose: () => ({ records: [{ nodeCode: 'before_breakfast', recordDate: '2026-10-14', ...measured(6.2) }] }) })
  await page.syncTodayFromServer()
  assert.equal(page.data.nodes[0].value, 6.2)
  assert.equal(page.data.nodes[0].recordedAt, '2026-10-14T07:12:34.123456')
  assert.equal(page.data.nodes[0].sourceType, 2)
  assert.equal(calls.recordsQuery[0].startDate, '2026-10-14')
  assert.equal(calls.recordsQuery[0].endDate, '2026-10-14')
  assert.equal(calls.writes.length, 1)
})

test('血糖列表失败时看板兜底，只在值相同时保留缓存时间', async () => {
  for (const value of [6.2, 9]) {
    const { page } = createPage({ records: { before_breakfast: measured() },
      board: () => ({ nodes: [{ nodeCode: 'before_breakfast', hasRecord: true, value, sourceType: 1 }] }),
      glucose: () => { throw new Error('网络不可用') } })
    await page.syncTodayFromServer()
    assert.equal(page.data.nodes[0].value, value)
    assert.equal(page.data.nodes[0].recordedAt, value === 6.2 ? '2026-10-14T07:12:34.123456' : '')
  }
})

test('已选记录刷新后更新详情，记录删除时清除选中状态', async () => {
  let records = [{ nodeCode: 'before_breakfast', ...measured(7.1) }]
  const { page, render } = createPage({ records: { before_breakfast: measured() }, glucose: () => ({ records }) })
  render()
  tap(page, page._chartGeometry.points[0])
  await page.syncTodayFromServer()
  assert.equal(page.data.chartSelection.value, 7.1)
  records = []
  await page.syncTodayFromServer()
  assert.equal(page.data.chartSelection, null)
  assert.equal(page.data.selectedChartNodeId, '')
})

test('离开页面、日期变化或账号切换后，不用旧请求改写当天缓存', async () => {
  for (const action of ['hide', 'date', 'token']) {
    let resolve
    const { page, state, calls } = createPage({ glucose: () => new Promise((done) => { resolve = done }) })
    const request = page.syncTodayFromServer()
    if (action === 'hide') page.onHide()
    if (action === 'date') state.date = '2026-10-15'
    if (action === 'token') state.token = 'another-user'
    resolve({ records: [{ nodeCode: 'before_breakfast', ...measured() }] })
    await request
    assert.equal(calls.writes.length, 0)
  }
})

test('模板触摸事件均有处理函数，详情位于Canvas下方而非遮盖浮层', () => {
  const template = fs.readFileSync(path.join(directory, 'ai.wxml'), 'utf8')
  const { page } = createPage()
  for (const [, handler] of template.matchAll(/(?:bindtap|bindtouchstart|bindtouchmove|bindtouchend|bindtouchcancel)="(\w+)"/g)) {
    assert.equal(typeof page[handler], 'function', handler)
  }
  assert.ok(template.indexOf('</canvas>') < template.indexOf('class="chart-details '))
  assert.match(template, /chartSelection.recordedAtText/)
})

test('日看板映射保留已有sourceType，无后端DTO修改', () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.resolve(directory, '../../utils/mappers.js'), 'utf8'), {
    module, require: () => ({ getFoodImage: () => '' })
  })
  const result = module.exports.mapDayBoard({ nodes: [{ nodeCode: 'before_breakfast', hasRecord: true,
    glucose: { glucoseValue: 6, sourceType: 3 } }] })
  assert.equal(result.nodes[0].sourceType, 3)
})

test('三餐推荐预测映射三个餐后，缺失或非法推荐值不回退当前吃法、不增加实测进度', () => {
  const { page, render } = createPage({ records: {
    breakfast: { type: 'meal', predictedGlucose: 30, suggestedGlucose: 7.2 },
    lunch: { type: 'meal', predictedGlucose: 31, suggestedGlucose: 8 },
    dinner: { type: 'meal', predictedGlucose: 32, suggestedGlucose: 6.9 }
  } })
  render()
  assert.equal(page.data.recordCount, 0)
  assert.deepEqual(Array.from(page._chartGeometry.predictionPoints, (point) => point.value), [7.2, 8, 6.9])
  assert.deepEqual(Array.from(page._chartGeometry.predictionPoints, (point) => point.x),
    [1, 3, 5].map((index) => page._chartGeometry.points[index].x))
  for (const value of [null, undefined, '', 'bad', 0, -1, 40]) {
    assert.equal(chart.getRecommendedPrediction({ isMeal: true, hasRecord: true, predictionValue: value }), null)
  }
  const invalid = createPage({ records: { breakfast: { type: 'meal', predictedGlucose: 9 } } })
  invalid.render()
  assert.equal(invalid.page._chartGeometry.predictionPoints.length, 0)
})

test('预测虚线白底空心点先绘制，实测实线和异常实心点最后突出', () => {
  const { render, calls } = createPage({ records: {
    after_breakfast: measured(3.2), after_dinner: measured(8.1),
    breakfast: { type: 'meal', suggestedGlucose: 7 }, dinner: { type: 'meal', suggestedGlucose: 8 }
  } })
  render()
  const dashed = calls.canvas.findIndex((call) => call.method === 'setLineDash' && call.args[0].length > 0)
  const solid = calls.canvas.findIndex((call, index) => index > dashed && call.method === 'setLineDash' && call.args[0].length === 0)
  assert.ok(dashed >= 0 && solid > dashed)
  const styleAfter = calls.canvas.slice(solid).filter((call) => call.method === 'style')
  assert.ok(styleAfter.some((call) => call.args[0] === 'fillStyle' && call.args[1] === '#fff'))
  assert.ok(styleAfter.some((call) => call.args[0] === 'fillStyle' && call.args[1] === '#fa5151'))
  assert.ok(styleAfter.some((call) => call.args[0] === 'lineWidth' && call.args[1] === 2.5))
})

test('重合点优先实测，预测刷新和删除会同步更新已打开详情', async () => {
  let meals = [{ nodeCode: 'breakfast', predictNow: 20, predictSuggest: 7 }]
  const { page, render } = createPage({ records: { after_breakfast: measured(7),
    breakfast: { type: 'meal', suggestedGlucose: 7 } }, meals: () => ({ meals }),
    glucose: () => ({ records: [] }) })
  render()
  tap(page, page._chartGeometry.predictionPoints[0])
  assert.equal(page.data.chartSelection.nodeId, 'after_breakfast')
  await page.syncTodayFromServer()
  render()
  tap(page, page._chartGeometry.predictionPoints[0])
  assert.equal(page.data.chartSelection.nodeId, 'breakfast')
  meals = [{ nodeCode: 'breakfast', predictNow: 30, predictSuggest: 8.1 }]
  await page.syncTodayFromServer()
  assert.equal(page.data.chartSelection.value, 8.1)
  meals = []
  await page.syncTodayFromServer()
  assert.equal(page.data.chartSelection, null)
})
