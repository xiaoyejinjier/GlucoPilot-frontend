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

function createPage(options = {}) {
  let definition
  const calls = { summaries: [], glucose: [], meals: [], photos: [], updates: 0 }
  const api = {
    fetchGlucoseSummary: async (query) => {
      calls.summaries.push({ ...query })
      if (options.summary) return options.summary(query)
      return { calendarMap: { 14: { count: 3, level: 'c' } }, monthRecordDays: 1, monthTotal: 3, compliance: 3,
        slotStats: [], week: { ...query, avg: null, max: null, min: null, points: [] } }
    },
    fetchGlucoseRecords: async (query) => {
      calls.glucose.push({ ...query })
      return options.glucose ? options.glucose(query, calls.glucose.length) : { records: [] }
    },
    fetchDayMeals: async (date) => {
      calls.meals.push(date)
      return options.meals ? options.meals(date) : { meals: [] }
    }
  }
  const dependencies = {
    '../../utils/locales/en': require('../../utils/locales/en'),
    '../../services/api': api, '../../utils/constants': { GLUCOSE_NODES }, '../../utils/stats-week': dates,
    '../../utils/meal-details': require('../../utils/meal-details'),
    '../../utils/glucose-chart': require('../../utils/glucose-chart'),
    '../../utils/display': { applyDisplayToCurrentPage() {}, getTheme: () => ({ brand: '#07c160' }), getDisplaySettings: () => ({}) }
  }
  vm.runInNewContext(source, { Page: (value) => { definition = value },
    require: (name) => { if (!dependencies[name]) throw new Error(name); return dependencies[name] },
    wx: { showToast() {}, navigateTo() {}, switchTab() {}, previewImage: (photo) => calls.photos.push(photo), nextTick: (callback) => callback() }, setTimeout, clearTimeout })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (values, callback) { calls.updates++; Object.assign(this.data, values); if (callback) callback() }
  page.drawWeekChart = () => {}
  page.setData({ year: 2026, month: 10, selectedDay: 14 })
  return { page, calls }
}

const monthEvent = (month) => ({ currentTarget: { dataset: { month } } })
const dayEvent = (day) => ({ currentTarget: { dataset: { day } } })
const modeEvent = (mode) => ({ currentTarget: { dataset: { mode } } })
const mealEvent = (id) => ({ currentTarget: { dataset: { id } } })

test('点击已记录正餐展开完整食物明细，再次点击收起，可切换正餐', async () => {
  const { page } = createPage({ meals: () => ({ meals: [
    { nodeCode: 'breakfast', foodsText: '米饭、鸡蛋、豆腐、青菜以及水果', items: [{ foodName: '米饭', weightG: 100, carbsG: 26, caloriesKcal: 116 }] },
    { nodeCode: 'lunch', foodsText: '面条、牛肉' }
  ] }) })
  await page.onMonthTap(monthEvent(10))
  await flush()
  page.onMealDetailTap(mealEvent('breakfast'))
  assert.equal(page.data.expandedMealId, 'breakfast')
  const detail = page.data.dayRecords.find((item) => item.id === 'breakfast').detail
  assert.equal(detail.foodsText, '米饭、鸡蛋、豆腐、青菜以及水果')
  assert.equal(detail.recordDate, '2026-10-14')
  assert.equal(detail.items[0].weightText, '100 g')
  page.onMealDetailTap(mealEvent('lunch'))
  assert.equal(page.data.expandedMealId, 'lunch')
  page.onMealDetailTap(mealEvent('lunch'))
  assert.equal(page.data.expandedMealId, '')
})

test('未记录正餐、血糖行、无效节点及隐藏/加载/失败状态不打开详情', async () => {
  const { page } = createPage({ meals: () => ({ meals: [{ nodeCode: 'breakfast', foodsText: '鸡蛋' }] }),
    glucose: () => ({ records: [{ nodeCode: 'before_breakfast', value: 6 }] }) })
  await page.buildDayRecords(14)
  page.data.viewMode = 'day'
  for (const id of ['dinner', 'before_breakfast', 'invalid']) page.onMealDetailTap(mealEvent(id))
  assert.equal(page.data.expandedMealId, '')
  for (const values of [{ activeView: 'glucose' }, { viewMode: 'month' }, { dayLoading: true }, { dayLoadFailed: true }]) {
    page.setData({ activeView: 'calendar', viewMode: 'day', dayLoading: false, dayLoadFailed: false, ...values })
    page.onMealDetailTap(mealEvent('breakfast'))
    assert.equal(page.data.expandedMealId, '')
  }
})

test('更换日期立即收起旧正餐明细，并展示新日期的完整快照', async () => {
  const { page } = createPage({ meals: (date) => ({ meals: [{ nodeCode: 'breakfast', foodsText: date }] }) })
  await page.onMonthTap(monthEvent(10))
  await flush()
  page.onMealDetailTap(mealEvent('breakfast'))
  page.onDayTap(dayEvent(15))
  assert.equal(page.data.expandedMealId, '')
  await flush()
  page.onMealDetailTap(mealEvent('breakfast'))
  assert.equal(page.data.dayRecords.find((item) => item.id === 'breakfast').detail.foodsText, '2026-10-15')
})

test('重新读取失败清空正餐详情，旧日期响应不会重新打开详情', async () => {
  let fail = false
  const { page } = createPage({ meals: () => {
    if (fail) throw new Error('读取失败')
    return { meals: [{ nodeCode: 'breakfast', foodsText: '米饭' }] }
  } })
  await page.onMonthTap(monthEvent(10))
  await flush()
  page.onMealDetailTap(mealEvent('breakfast'))
  fail = true
  await page.onRetryDay()
  assert.equal(page.data.expandedMealId, '')
  assert.equal(page.data.dayRecords.length, 0)
  assert.equal(page.data.dayLoadFailed, true)
})

test('返回月视图、切换血糖视图或离开页面会收起正餐', () => {
  for (const action of [(page) => page.onViewMode(modeEvent('month')), (page) => page.onSwitchToCalendar(),
    (page) => page.onSwitchToGlucose(), (page) => page.onSwitchView({ currentTarget: { dataset: { view: 'glucose' } } }),
    (page) => page.onHide()]) {
    const { page } = createPage()
    page.setData({ viewMode: 'day', expandedMealId: 'breakfast' })
    action(page)
    assert.equal(page.data.expandedMealId, '')
  }
})

test('只有当前展开且有真实照片的正餐可以预览原图', async () => {
  const { page, calls } = createPage({ meals: () => ({ meals: [
    { nodeCode: 'breakfast', foodsText: '米饭', mediaUrl: '/photo/example.jpg' },
    { nodeCode: 'lunch', foodsText: '面条' }
  ] }) })
  await page.onMonthTap(monthEvent(10))
  await flush()
  page.onPreviewMealPhoto(mealEvent('breakfast'))
  assert.equal(calls.photos.length, 0)
  page.onMealDetailTap(mealEvent('breakfast'))
  page.onPreviewMealPhoto(mealEvent('breakfast'))
  assert.equal(calls.photos.length, 1)
  assert.equal(calls.photos[0].current, '/photo/example.jpg')
  assert.equal(calls.photos[0].urls[0], '/photo/example.jpg')
  page.onMealDetailTap(mealEvent('lunch'))
  page.onPreviewMealPhoto(mealEvent('breakfast'))
  page.onPreviewMealPhoto(mealEvent('lunch'))
  assert.equal(calls.photos.length, 1)
})

test('正餐详情使用可换行文本和快照，不限制行数；逐项循环不覆盖外层 item', () => {
  const template = fs.readFileSync(path.join(directory, 'stats.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(directory, 'stats.wxss'), 'utf8')
  assert.match(template, /bindtap="onMealDetailTap"/)
  assert.match(template, /expandedMealId === item.id && item.detail/)
  assert.match(template, /wx:for-item="food"/)
  assert.match(template, /item.detail.foodsText/)
  assert.match(style, /\.meal-detail-full-text\s*\{[^}]*white-space:\s*pre-wrap;[^}]*word-break:\s*break-all;/)
  assert.doesNotMatch(style, /\.meal-detail-full-text\s*\{[^}]*(line-clamp|text-overflow)/)
})

test('月视图包含1～12月入口，不伪造每月记录数', () => {
  const { page } = createPage()
  assert.equal(page.data.viewMode, 'month')
  assert.deepEqual(page.data.months.map((item) => item.month), Array.from({ length: 12 }, (_, index) => index + 1))
  assert.ok(page.data.months.every((item) => !Object.hasOwn(item, 'count')))
})

test('点击不同月份进入日视图，默认历史月份首日并查询真实月份/日期', async () => {
  const { page, calls } = createPage()
  page.data.weekAnchorDate = '2026-10-05'
  await page.onMonthTap(monthEvent('1'))
  await flush()
  assert.equal(page.data.viewMode, 'day')
  assert.equal(page.data.month, 1)
  assert.equal(page.data.selectedDay, 1)
  assert.equal(page.data.weekAnchorDate, '')
  assert.equal(calls.summaries.at(-1).month, 1)
  assert.equal(calls.glucose.at(-1).startDate, '2026-01-01')
  assert.equal(calls.meals.at(-1), '2026-01-01')
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 31)
})

test('点击已选月份保留选中日，日历和选中日记录同时存在', async () => {
  const { page } = createPage()
  await page.onMonthTap(monthEvent(10))
  await flush()
  assert.equal(page.data.selectedDay, 14)
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 31)
  assert.equal(page.data.dayRecords.length, 9)
  page.onDayTap(dayEvent('20'))
  await flush()
  assert.equal(page.data.selectedDay, 20)
  assert.equal(page.data.viewMode, 'day')
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 31)
  assert.equal(page.data.dayRecords.length, 9)
})

test('日明细合并实测血糖和正餐，只按实测血糖计算均值', async () => {
  const { page } = createPage({
    glucose: () => ({ records: [{ nodeCode: 'before_breakfast', value: 5 }, { nodeCode: 'after_breakfast', value: 7 }] }),
    meals: () => ({ meals: [{ nodeCode: 'breakfast', foodsText: '米饭100g', predictNow: 30 }] })
  })
  await page.onMonthTap(monthEvent(10))
  await flush()
  assert.equal(page.data.dayRecords.length, 9)
  assert.equal(page.data.dayCompleted, 3)
  assert.equal(page.data.dayCompletion, 33)
  assert.equal(page.data.dayGlucoseAvg, '6.0')
  assert.match(page.data.dayRecords.find((record) => record.id === 'breakfast').text, /米饭100g/)
  assert.equal(page.data.dayRecords.find((record) => record.id === 'before_lunch').text, '未记录')
})

test('空记录日显示九个未记录节点和无均值，空血糖不当作0参与平均', async () => {
  const { page } = createPage()
  await page.buildDayRecords(14)
  assert.equal(page.data.dayRecords.length, 9)
  assert.ok(page.data.dayRecords.every((record) => !record.recorded))
  assert.equal(page.data.dayCompleted, 0)
  assert.equal(page.data.dayGlucoseAvg, '--')
  const invalid = createPage({ glucose: () => ({ records: [
    { nodeCode: 'before_breakfast', value: null }, { nodeCode: 'after_breakfast', value: 6 }
  ] }) })
  await invalid.page.buildDayRecords(14)
  assert.equal(invalid.page.data.dayGlucoseAvg, '6.0')
})

test('年份切换保留12个月入口并处理闰年日期，不加载隐藏的日明细', async () => {
  const { page, calls } = createPage()
  page.setData({ year: 2024, month: 2, selectedDay: 29, weekAnchorDate: '2024-02-26' })
  await page.onNextYear()
  assert.equal(page.data.year, 2025)
  assert.equal(page.data.selectedDay, 28)
  assert.equal(page.data.viewMode, 'month')
  assert.equal(page.data.weekAnchorDate, '')
  assert.equal(page.data.months.length, 12)
  assert.equal(calls.glucose.length, 0)
  await page.onPrevYear()
  assert.equal(page.data.year, 2024)
})

test('日视图切换月份与相邻日期支持跨年/跨月，日历与明细同步', async () => {
  const { page, calls } = createPage()
  page.setData({ year: 2026, month: 1, selectedDay: 31, viewMode: 'day' })
  page.onNextDay()
  await flush()
  assert.equal(page.data.month, 2)
  assert.equal(page.data.selectedDay, 1)
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 28)
  assert.equal(calls.meals.at(-1), '2026-02-01')
  page.onPrevDay()
  await flush()
  assert.equal(page.data.month, 1)
  assert.equal(page.data.selectedDay, 31)
  await page.onPrevMonth()
  await flush()
  assert.equal(page.data.year, 2025)
  assert.equal(page.data.month, 12)
  assert.equal(page.data.viewMode, 'day')
  assert.equal(calls.meals.at(-1), '2025-12-01')
})

test('快速点选日期清空旧明细，晚返回的旧日请求不会覆盖新日', async () => {
  const pending = []
  const { page } = createPage({ glucose: (query) => new Promise((resolve) => pending.push({ query, resolve })) })
  page.onDayTap(dayEvent(14))
  assert.equal(page.data.dayLoading, true)
  assert.equal(page.data.dayRecords.length, 0)
  page.onDayTap(dayEvent(15))
  pending[1].resolve({ records: [{ nodeCode: 'before_breakfast', value: 7 }] })
  await flush()
  pending[0].resolve({ records: [{ nodeCode: 'before_breakfast', value: 9 }] })
  await flush()
  assert.equal(page.data.selectedDay, 15)
  assert.equal(page.data.dayGlucoseAvg, '7.0')
  assert.equal(page.data.dayLoading, false)
})

test('日历汇总失败时，成功读取的日明细仍独立展示', async () => {
  const { page } = createPage({ summary: () => { throw new Error('汇总失败') },
    glucose: () => ({ records: [{ nodeCode: 'before_breakfast', value: 6 }] }) })
  await page.onMonthTap(monthEvent(10))
  await flush()
  assert.equal(page.data.weekLoadFailed, true)
  assert.equal(page.data.dayLoadFailed, false)
  assert.equal(page.data.dayRecords.length, 9)
  assert.equal(page.data.dayGlucoseAvg, '6.0')
})

test('同月选日保留日期日历，换月份期间不显示旧月份日期', async () => {
  let hold = false
  let resolveSummary
  const { page } = createPage({ summary: (query) => {
    const summary = { calendarMap: {}, monthRecordDays: 0, monthTotal: 0, compliance: 0,
      slotStats: [], week: { ...query, avg: null, max: null, min: null, points: [] } }
    return hold ? new Promise((resolve) => { resolveSummary = () => resolve(summary) }) : summary
  } })
  await page.onMonthTap(monthEvent(10))
  hold = true
  page.onDayTap(dayEvent(15))
  assert.equal(page.data.loading, true)
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 31)
  resolveSummary()
  await flush()
  const request = page.onMonthTap(monthEvent(2))
  assert.equal(page.data.calendarDays.length, 0)
  resolveSummary()
  await request
  assert.equal(page.data.calendarDays.filter((item) => item.day).length, 28)
})

test('日明细失败清空旧数据，可单独重试且不重复请求月汇总', async () => {
  const { page, calls } = createPage({ glucose: (query, count) => {
    if (count === 1) throw new Error('日明细失败')
    return { records: [{ nodeCode: 'before_breakfast', value: 6 }] }
  } })
  await page.onMonthTap(monthEvent(10))
  await flush()
  assert.equal(page.data.dayLoadFailed, true)
  assert.equal(page.data.dayRecords.length, 0)
  assert.equal(page.data.dayGlucoseAvg, '--')
  await page.onRetryDay()
  assert.equal(page.data.dayLoadFailed, false)
  assert.equal(page.data.dayCompleted, 1)
  assert.equal(calls.summaries.length, 1)
})

test('返回月份列表时保留所选年月并使未完成的日请求失效', async () => {
  let resolve
  const { page, calls } = createPage({ glucose: () => new Promise((done) => { resolve = done }) })
  await page.onMonthTap(monthEvent(10))
  page.onViewMode(modeEvent('month'))
  const updates = calls.updates
  resolve({ records: [{ nodeCode: 'before_breakfast', value: 9 }] })
  await flush()
  assert.equal(page.data.viewMode, 'month')
  assert.equal(page.data.month, 10)
  assert.equal(page.data.selectedDay, 14)
  assert.equal(calls.updates, updates)
})

test('无效月份、日期、视图模式不改变页面或查询数据', () => {
  const { page, calls } = createPage()
  for (const month of [0, 13, 'invalid', 1.5]) page.onMonthTap(monthEvent(month))
  for (const day of [0, 32, 'invalid', 1.5]) page.onDayTap(dayEvent(day))
  page.onViewMode(modeEvent('invalid'))
  assert.equal(page.data.month, 10)
  assert.equal(page.data.selectedDay, 14)
  assert.equal(calls.summaries.length, 0)
})

test('模板包含月份入口与下方独立日明细，所有标签正确闭合', () => {
  const template = fs.readFileSync(path.join(directory, 'stats.wxml'), 'utf8')
  assert.match(template, /wx:for="\{\{months\}\}"/)
  assert.match(template, /bindtap="onMonthTap"/)
  assert.ok(template.indexOf('class="calendar"') < template.indexOf('day-details-card'))
  assert.match(template, /点击日期，下方显示当天的九时段记录/)
  const stack = []
  for (const match of template.matchAll(/<\/?([\w:-]+)\b[^>]*>/g)) {
    if (match[0].startsWith('</')) assert.equal(stack.pop(), match[1], match[0])
    else if (!match[0].endsWith('/>')) stack.push(match[1])
  }
  assert.equal(stack.length, 0)
})
