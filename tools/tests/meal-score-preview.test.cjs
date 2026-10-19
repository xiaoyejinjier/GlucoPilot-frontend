const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageDirectory = path.resolve(__dirname, '../../pages/food-analysis')
const pageSource = fs.readFileSync(path.join(pageDirectory, 'food-analysis.js'), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const identifiedMeal = () => ({
  items: [{ foodName: '米饭', foodId: 12, categoryCode: 1, weightG: 100,
    carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY' }],
  matchedCount: 1, newFoodsCount: 0, warnings: [], model: 'test-vision'
})
const defaultPrediction = () => ({ predictNow: 10.6, predictSuggest: 7.8, suggestText: '建议主食适量减少' })

// 可手动推进的假定时器：页面防抖 800ms 在测试中由 runPending/flush 触发。
function createTimers() {
  const pending = new Map()
  let seq = 0
  return {
    setTimeout(fn) { const id = ++seq; pending.set(id, fn); return id },
    clearTimeout(id) { pending.delete(id) },
    runPending() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn() },
    async flush() {
      while (pending.size) {
        this.runPending()
        await flush()
      }
    }
  }
}

function createPage(options = {}) {
  let definition
  const timers = createTimers()
  const calls = { analysis: 0, upload: 0, predictions: 0, predictPayloads: [], payloads: [], records: [], updates: 0 }
  const modules = {
    '../../services/api': {
      analyzeMealPhoto: async () => {
        calls.analysis++
        return options.analyze ? options.analyze(calls.analysis) : identifiedMeal()
      },
      predictMealGlucose: async (payload) => {
        calls.predictions++
        calls.predictPayloads.push(payload)
        return options.predict ? options.predict(payload, calls.predictions) : defaultPrediction()
      },
      saveMealRecord: async (payload) => { calls.payloads.push(payload) }
    },
    '../../utils/storage': {
      getTodayKey: () => '2026-10-19',
      getRecords: () => options.glucose != null ? { before_breakfast: { type: 'glucose', value: options.glucose } } : {},
      saveRecord: (...args) => calls.records.push(args)
    },
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/shot': { readShotImage: () => 'meal-photo.jpg', clearShotImage() {} },
    '../../utils/media': { uploadMealImage: async () => { calls.upload++; return { id: 7 } } },
    '../../utils/request': { getToken: () => 'test-token' },
    '../../utils/record-window': { getNodeRecordWindow: () => ({ locked: false }) }
  }
  vm.runInNewContext(pageSource, {
    Page: (page) => { definition = page },
    require: (name) => {
      if (!(name in modules)) throw new Error('Unexpected dependency: ' + name)
      return modules[name]
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    wx: { showModal() {}, showToast() {}, showLoading() {}, hideLoading() {}, switchTab() {}, redirectTo() {} },
    console
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (update) {
    calls.updates++
    for (const [key, value] of Object.entries(update)) {
      const segments = key.split('.')
      let target = this.data
      for (const segment of segments.slice(0, -1)) target = target[segment]
      target[segments.at(-1)] = value
    }
  }
  return { page, calls, timers }
}

test('识别成功且已有餐前血糖，防抖后自动首调真实预测', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.currentGlucose, '5.6')
  assert.equal(page.data.analysisReady, true)
  // 防抖窗口内尚未发起
  assert.equal(calls.predictions, 0)
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(calls.predictPayloads[0].nodeCode, 'breakfast')
  assert.equal(calls.predictPayloads[0].currentGlucose, 5.6)
  assert.equal(calls.predictPayloads[0].carbsG, 25)
  assert.equal(calls.predictPayloads[0].items[0].categoryCode, 1)
  assert.equal(page.data.predictLoading, false)
  assert.equal(page.data.predictResult.predictNow, 10.6)
  assert.equal(page.data.predictResult.predictSuggest, 7.8)
  assert.equal(page.data.predictResult.predictCarbs, 25)
  assert.equal(page.data.predictError, '')
})

test('未录餐前血糖为空态不发起预测，补充血糖后触发', async () => {
  const { page, calls, timers } = createPage()
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.currentGlucose, '')
  assert.equal(calls.predictions, 0)
  assert.equal(page.data.predictResult, null)
  assert.equal(page.data.predictError, '')
  page.onCurrentGlucoseInput({ detail: { value: '6.2' } })
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(calls.predictPayloads[0].currentGlucose, 6.2)
})

test('未分类食物不入预测且碳水扣减，保存仍用全量（方案B）', async () => {
  const mixedMeal = () => ({
    items: [
      { foodName: '米饭', foodId: 12, categoryCode: 1, weightG: 100, carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY' },
      { foodName: '不明小吃', weightG: 50, carbsPer100g: 40, caloriesPer100g: 200, nutritionSource: 'AI_ESTIMATE' }
    ],
    matchedCount: 1, newFoodsCount: 0, warnings: [], model: 'test-vision'
  })
  const { page, calls, timers } = createPage({ glucose: 5.6, analyze: async () => mixedMeal() })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(calls.predictions, 1)
  const predictPayload = calls.predictPayloads[0]
  assert.equal(predictPayload.items.length, 1)
  assert.equal(predictPayload.items[0].foodName, '米饭')
  assert.equal(predictPayload.carbsG, 25)
  assert.ok(page.data.predictNotice.includes('1 项未分类'))
  await page.onSave()
  assert.equal(calls.payloads.length, 1)
  const payload = calls.payloads[0]
  assert.equal(payload.carbsG, 45)
  assert.equal(payload.items.length, 2)
})

test('修改重量防抖重算，预测碳水同步更新', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(calls.predictPayloads[0].carbsG, 25)
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  await flush()
  // 防抖窗口内不重复发起
  assert.equal(calls.predictions, 1)
  await timers.flush()
  assert.equal(calls.predictions, 2)
  assert.equal(calls.predictPayloads[1].carbsG, 50)
  assert.equal(page.data.predictResult.predictCarbs, 50)
})

test('乱序响应按版本与参数指纹丢弃旧结果', async () => {
  const deferred = []
  const { page, calls, timers } = createPage({ glucose: 5.6, predict: () => new Promise((resolve) => deferred.push(resolve)) })
  await page.onLoad({})
  await flush()
  timers.runPending()
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  timers.runPending()
  deferred[1]({ predictNow: 8.8, predictSuggest: 7.2, suggestText: '新参数结果' })
  await flush()
  assert.equal(page.data.predictResult.predictNow, 8.8)
  deferred[0]({ predictNow: 12.5, predictSuggest: 9.9, suggestText: '旧参数结果' })
  await flush()
  assert.equal(page.data.predictResult.predictNow, 8.8)
  assert.equal(calls.predictions, 2)
})

test('预测失败清空结果，保存不携带预测三列（P4）', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6, predict: () => { throw new Error('预测服务不可用') } })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(page.data.predictResult, null)
  assert.equal(page.data.predictLoading, false)
  assert.ok(page.data.predictError.includes('预测服务不可用'))
  await page.onSave()
  assert.equal(calls.payloads.length, 1)
  for (const key of ['predictNow', 'predictSuggest', 'suggestText', 'score', 'scorePreview']) {
    assert.equal(Object.hasOwn(calls.payloads[0], key), false)
  }
  assert.equal(calls.records[0][1].predictedGlucose, null)
  assert.equal(calls.records[0][1].suggestedGlucose, null)
})

test('预测成功后保存携带预测三列，模拟评分字段禁入', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.predictResult.predictNow, 10.6)
  await page.onSave()
  assert.equal(calls.payloads.length, 1)
  const payload = calls.payloads[0]
  assert.equal(payload.mediaId, 7)
  assert.equal(payload.carbsG, 25)
  assert.equal(payload.predictNow, 10.6)
  assert.equal(payload.predictSuggest, 7.8)
  assert.equal(payload.suggestText, '建议主食适量减少')
  for (const key of ['score', 'scorePreview']) {
    assert.equal(Object.hasOwn(payload, key), false)
  }
  const cached = calls.records[0][1]
  assert.equal(cached.predictedGlucose, 10.6)
  assert.equal(cached.suggestedGlucose, 7.8)
  assert.equal(Object.hasOwn(cached, 'score'), false)
})

test('补充信息或退出页面后，迟到响应不回写旧结果', async () => {
  for (const action of ['supplement', 'unload']) {
    const deferred = []
    const { page, calls, timers } = createPage({ glucose: 5.6, predict: () => new Promise((resolve) => deferred.push(resolve)) })
    await page.onLoad({})
    await flush()
    timers.runPending()
    assert.equal(page.data.predictLoading, true)
    if (action === 'supplement') page.onSupplementInput({ detail: { value: '重新识别' } })
    else page.onUnload()
    const countBefore = calls.updates
    deferred[0]({ predictNow: 99, predictSuggest: 88, suggestText: '迟到结果' })
    await flush()
    assert.equal(calls.updates, countBefore)
    assert.equal(page.data.predictResult, null)
  }
})

test('切换饥饿感不触发预测重算', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(calls.predictions, 1)
  page.onHunger({ currentTarget: { dataset: { val: '微饿' } } })
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(page.data.hunger, '微饿')
})

test('模板为两段对比预测卡片，模拟评分残留已清除', () => {
  const template = fs.readFileSync(path.join(pageDirectory, 'food-analysis.wxml'), 'utf8')
  assert.ok(template.indexOf('餐后血糖预测') < template.indexOf('识别的食物与营养'))
  assert.match(template, /predictResult\.predictNow/)
  assert.match(template, /predictResult\.predictSuggest/)
  assert.match(template, /bindtap="onRetryPredict"/)
  for (const stale of ['scorePreview', 'onRefreshScore', '模拟预测评分', '演示数据']) {
    assert.doesNotMatch(template, new RegExp(stale))
  }
})
