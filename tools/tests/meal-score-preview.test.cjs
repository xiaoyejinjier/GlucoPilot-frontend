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
const defaultPrediction = () => ({ predictNow: 10.6, predictSuggest: 7.8, suggestText: '建议主食适量减少',
  suggestCarbs: 55, suggestItems: [{ foodName: '米饭', suggestWeight: 112 }] })

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
  const calls = { analysis: 0, upload: 0, predictions: 0, predictPayloads: [], payloads: [], upserts: [], records: [], updates: 0, toasts: [], navigations: [], modals: [], setDataKeys: [] }
  const modules = {
    '../../services/api': {
      analyzeMealPhoto: async () => {
        calls.analysis++
        return options.analyze ? options.analyze(calls.analysis) : identifiedMeal()
      },
      upsertGlucoseRecord: async (payload) => {
        calls.upserts.push(payload)
        if (options.upsertFail) throw options.upsertFail
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
      getRecords: () => {
        if (options.records instanceof Function) return options.records()
        if (options.records != null) return options.records
        return options.glucose != null ? { before_breakfast: { type: 'glucose', value: options.glucose } } : {}
      },
      saveRecord: (...args) => calls.records.push(args)
    },
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/shot': { readShotImage: () => 'meal-photo.jpg', clearShotImage() {} },
    '../../utils/media': { uploadMealImage: async () => { calls.upload++; return { id: 7 } } },
    '../../utils/request': { getToken: () => 'test-token' },
    '../../utils/record-window': { getNodeRecordWindow: (nodeId) => (options.windowLocked && nodeId === 'before_lunch' ? { locked: true, lockReason: '该时段已截止' } : { locked: false }) },
    '../../utils/constants': require('../../utils/constants')
  }
  vm.runInNewContext(pageSource, {
    Page: (page) => { definition = page },
    require: (name) => {
      if (!(name in modules)) throw new Error('Unexpected dependency: ' + name)
      return modules[name]
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    wx: {
      showModal: (...args) => calls.modals.push(args),
      showToast: (...args) => calls.toasts.push(args),
      navigateTo: (...args) => calls.navigations.push(args),
      showLoading() {}, hideLoading() {}, switchTab() {}, redirectTo() {}
    },
    console
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (update) {
    calls.updates++
    for (const [key, value] of Object.entries(update)) {
      calls.setDataKeys.push(key)
      const segments = key.split('.')
      let target = this.data
      for (const segment of segments.slice(0, -1)) {
        const indexed = segment.match(/^(.+)\[(\d+)\]$/)
        target = indexed ? target[indexed[1]][Number(indexed[2])] : target[segment]
      }
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

test('草稿输入不触发预测，点击确定才更新并重算', async () => {
  const { page, calls, timers } = createPage()
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.currentGlucose, '')
  assert.equal(calls.predictions, 0)
  assert.equal(page.data.predictResult, null)
  assert.equal(page.data.predictError, '')
  page.onGlucoseInput({ detail: { value: '6.2' } })
  await flush()
  await timers.flush()
  assert.equal(page.data.glucoseInput, '6.2')
  assert.equal(page.data.currentGlucose, '')
  assert.equal(calls.predictions, 0)
  await page.onConfirmGlucose()
  await flush()
  // 手动确定与拍照打卡同链路：先落库到餐前节点，再写本地缓存并触发预测
  assert.equal(calls.upserts.length, 1)
  assert.equal(calls.upserts[0].nodeCode, 'before_breakfast')
  assert.equal(calls.upserts[0].glucoseValue, 6.2)
  assert.equal(calls.upserts[0].sourceType, 1)
  assert.equal(calls.records.length, 1)
  assert.equal(calls.records[0][0], 'before_breakfast')
  assert.equal(calls.records[0][1].value, 6.2)
  assert.equal(calls.records[0][1].type, 'glucose')
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(calls.predictPayloads[0].currentGlucose, 6.2)
  assert.equal(page.data.currentGlucose, '6.2')
  assert.equal(page.data.beforeMealRecorded, true)
  assert.equal(page.data.glucoseInput, '')
  assert.equal(page.data.predictResult.predictNow, 10.6)
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

test('防抖/在途窗口内保存：输入已变则丢弃旧预测量，不落库（指纹校验）', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  // 100g 时的预测已生效，并带上了当次输入的指纹
  assert.equal(page.data.predictResult.predictNow, 10.6)
  assert.equal(typeof page.data.predictResult.fingerprint, 'string')
  // 改重量到 200g：防抖窗口内未重算，predictResult 仍是旧输入的结果
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  await flush()
  assert.equal(page.data.predictResult.predictNow, 10.6)
  await page.onSave()
  assert.equal(calls.payloads.length, 1)
  // 保存用新碳水（50g），但预测三列因指纹不一致必须整体丢弃
  assert.equal(calls.payloads[0].carbsG, 50)
  for (const key of ['predictNow', 'predictSuggest', 'suggestText']) {
    assert.equal(Object.hasOwn(calls.payloads[0], key), false)
  }
  assert.equal(calls.records[0][1].predictedGlucose, null)
  assert.equal(calls.records[0][1].suggestedGlucose, null)
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

test('确定校验：空值/非数字/超范围/多余小数位拦截并提示，边界值通过', async () => {
  for (const bad of ['', 'abc', '0', '0.05', '39.96', '40']) {
    const { page, calls, timers } = createPage()
    await page.onLoad({})
    await flush()
    await timers.flush()
    page.onGlucoseInput({ detail: { value: bad } })
    await page.onConfirmGlucose()
    await timers.flush()
    assert.equal(calls.predictions, 0, 'input=' + bad)
    assert.equal(calls.upserts.length, 0, 'input=' + bad)
    assert.equal(page.data.currentGlucose, '', 'input=' + bad)
    assert.equal(calls.toasts.length, 1, 'input=' + bad)
    assert.ok(String(calls.toasts[0][0].title).includes('0.1-39.9'), 'input=' + bad)
  }
  const edge = createPage()
  await edge.page.onLoad({})
  await flush()
  await edge.timers.flush()
  edge.page.onGlucoseInput({ detail: { value: '39.9' } })
  await edge.page.onConfirmGlucose()
  await flush()
  await edge.timers.flush()
  assert.equal(edge.page.data.currentGlucose, '39.9')
  assert.equal(edge.calls.predictions, 1)
})

test('手动确定落库失败：保留输入与卡片，提示错误可重试', async () => {
  const { page, calls, timers } = createPage({ upsertFail: new Error('网络超时') })
  await page.onLoad({})
  await flush()
  await timers.flush()
  page.onGlucoseInput({ detail: { value: '5.9' } })
  await page.onConfirmGlucose()
  await flush()
  await timers.flush()
  // 失败不落库不写缓存，页面状态全部保留供重试
  assert.equal(calls.upserts.length, 1)
  assert.equal(calls.records.length, 0)
  assert.equal(page.data.currentGlucose, '')
  assert.equal(page.data.beforeMealRecorded, false)
  assert.equal(page.data.glucoseInput, '5.9')
  assert.equal(calls.predictions, 0)
  assert.equal(page.data.busy, false)
  assert.equal(calls.toasts.length, 1)
  assert.ok(String(calls.toasts[0][0].title).includes('网络超时'))
})

test('餐前血糖或本餐已有记录时隐藏手动输入卡', async () => {
  const none = createPage()
  await none.page.onLoad({})
  await flush()
  assert.equal(none.page.data.beforeMealRecorded, false)

  const glucoseRecorded = createPage({ records: { before_breakfast: { type: 'glucose', value: 5.6 } } })
  await glucoseRecorded.page.onLoad({})
  await flush()
  await glucoseRecorded.timers.flush()
  assert.equal(glucoseRecorded.page.data.beforeMealRecorded, true)
  assert.equal(glucoseRecorded.page.data.currentGlucose, '5.6')
  assert.equal(glucoseRecorded.calls.predictions, 1)

  const mealRecorded = createPage({ records: { breakfast: { type: 'meal', foods: '米饭' } } })
  await mealRecorded.page.onLoad({})
  await flush()
  assert.equal(mealRecorded.page.data.beforeMealRecorded, true)
  assert.equal(mealRecorded.page.data.currentGlucose, '')
})

test('打卡返回后 onShow 自动刷新血糖并重算', async () => {
  let records = {}
  const { page, calls, timers } = createPage({ records: () => records })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.beforeMealRecorded, false)
  assert.equal(calls.predictions, 0)
  // 模拟「去拍照记录」完成打卡：餐前血糖写入缓存
  records = { before_breakfast: { type: 'glucose', value: 5.8 } }
  page.onShow()
  await flush()
  assert.equal(page.data.beforeMealRecorded, true)
  assert.equal(page.data.currentGlucose, '5.8')
  assert.equal(page.data.glucoseInput, '5.8')
  await timers.flush()
  assert.equal(calls.predictions, 1)
  assert.equal(calls.predictPayloads[0].currentGlucose, 5.8)
})

test('去拍照记录跳转餐前节点，锁定时弹窗不跳转', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'lunch' })
  await flush()
  page.onGoMeasure()
  assert.equal(calls.navigations.length, 1)
  assert.ok(calls.navigations[0][0].url.includes('nodeId=before_lunch'))
  assert.ok(calls.navigations[0][0].url.includes('isMeal=0'))
  assert.ok(calls.navigations[0][0].url.includes('nodeName='))

  const locked = createPage({ windowLocked: true })
  await locked.page.onLoad({ nodeId: 'lunch' })
  await flush()
  locked.page.onGoMeasure()
  assert.equal(locked.calls.navigations.length, 0)
  assert.equal(locked.calls.modals.length, 1)
})

test('食物列表默认折叠前两项，展开后重新识别重置', async () => {
  const { page, calls, timers } = createPage({ analyze: async () => ({
    items: [
      { foodName: '米饭', foodId: 12, categoryCode: 1, weightG: 100, carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY' },
      { foodName: '清炒西兰花', foodId: 8, categoryCode: 3, weightG: 120, carbsPer100g: 4.3, caloriesPer100g: 34, nutritionSource: 'LIBRARY' },
      { foodName: '煎鸡蛋', categoryCode: 2, weightG: 55, carbsPer100g: 1.3, caloriesPer100g: 143, nutritionSource: 'AI_ESTIMATE' }
    ],
    matchedCount: 2, newFoodsCount: 1, warnings: [], model: 'test-vision'
  }) })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.items.length, 3)
  assert.equal(page.data.foodListExpanded, false)
  page.onToggleFoodList()
  assert.equal(page.data.foodListExpanded, true)
  page.onReAnalyze()
  await flush()
  await timers.flush()
  assert.equal(calls.analysis, 2)
  assert.equal(page.data.foodListExpanded, false)
  assert.equal(page.data.items.length, 3)
})

test('预测成功后建议按 foodName 联动写入列表，使用局部路径更新', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  assert.equal(page.data.suggestCount, 1)
  assert.equal(page.data.items[0].suggestWeight, 112)
  assert.equal(page.data.items[0].suggestMatched, true)
  assert.equal(page.data.items[0].suggestHint, '')  // 100g→112g 无削减，不附份数提示
  assert.equal(page.data.predictResult.suggestCarbs, 55)
  assert.ok(calls.setDataKeys.includes('items[0].suggestWeight'))
  // 建议写回必须用局部路径：最后一次建议写入之后不得再出现全量 items 覆盖（防失焦）
  const lastSuggestWrite = calls.setDataKeys.lastIndexOf('items[0].suggestWeight')
  assert.ok(!calls.setDataKeys.slice(lastSuggestWrite).includes('items'))
  // 建议削减场景：改重量 200g 后重算，112/200≈0.56 接近减半
  const deferred = { resolve: null }
  const controlled = createPage({ glucose: 5.6, predict: () => new Promise((resolve) => { deferred.resolve = resolve }) })
  await controlled.page.onLoad({})
  await flush()
  await controlled.timers.flush()
  controlled.page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  await controlled.timers.flush()
  deferred.resolve({ predictNow: 11, predictSuggest: 7.8, suggestText: 'x', suggestCarbs: 30,
    suggestItems: [{ foodName: '米饭', suggestWeight: 100 }] })
  await flush()
  await controlled.timers.flush()
  assert.equal(controlled.page.data.items[0].suggestWeight, 100)
  assert.equal(controlled.page.data.items[0].suggestHint, ' (减半)')
  // 危险场景空建议：suggestCount 归零后列表不渲染建议
  const danger = createPage({ glucose: 5.6, predict: async () => ({ predictNow: 20, predictSuggest: 16, suggestText: '暂缓', suggestCarbs: 0, suggestItems: [] }) })
  await danger.page.onLoad({})
  await flush()
  await danger.timers.flush()
  assert.equal(danger.page.data.suggestCount, 0)
  assert.equal(danger.page.data.items[0].suggestMatched, false)  // 空建议名单：箭头与状态整体隐藏
  assert.equal(danger.page.data.items[0].suggestWeight, null)  // 防御态按「正常」处理
})

test('保存请求与本地缓存不再携带饱腹感字段', async () => {
  const { page, calls, timers } = createPage({ glucose: 5.6 })
  await page.onLoad({})
  await flush()
  await timers.flush()
  page.onSave()
  await flush()
  assert.equal(calls.payloads.length, 1)
  assert.equal(Object.hasOwn(calls.payloads[0], 'hungerLevel'), false)
  const cached = calls.records[0][1]
  assert.equal(Object.hasOwn(cached, 'hunger'), false)
})

test('模板为两段对比预测卡片，模拟评分残留已清除', () => {
  const template = fs.readFileSync(path.join(pageDirectory, 'food-analysis.wxml'), 'utf8')
  assert.ok(template.indexOf('餐后血糖预测') < template.indexOf('识别的食物与营养'))
  assert.match(template, /predictResult\.predictNow/)
  assert.match(template, /predictResult\.predictSuggest/)
  assert.match(template, /bindtap="onRetryPredict"/)
  assert.match(template, /bindtap="onConfirmGlucose"/)
  assert.match(template, /bindtap="onGoMeasure"/)
  assert.match(template, /bindtap="onToggleFoodList"/)
  assert.match(template, /foodListExpanded \|\| index < 2/)
  assert.match(template, /展开查看全部/)
  assert.doesNotMatch(template, /onToggleGlucoseCard/)
  assert.match(template, /placeholder="{{i18n\.t\('如 5\.6', locale\)}}"/)
  assert.match(template, /去拍照记录/)
  assert.match(template, /推荐碳水/)
  assert.match(template, /i18n\.t\("建议吃 " \+ \(item\.suggestWeight\) \+ "g"/)
  assert.match(template, /suggestCount > 0/)
  assert.match(template, /food-suggest-arrow/)
  assert.match(template, /suggestCount > 0 && item\.suggestMatched/)
  assert.match(template, /class="food-suggest-group"/)
  assert.match(template, /wx:else class="food-suggest-muted muted-neutral"/)
  assert.match(template, /arrow-bad/)
  assert.match(template, /muted-neutral/)
  assert.doesNotMatch(template, /predict-suggest-text/)
  assert.doesNotMatch(template, /predict-col-current|predict-col-suggest/)
  assert.doesNotMatch(template, /per100Text/)
  assert.match(template, /!beforeMealRecorded/)
  for (const stale of ['scorePreview', 'onRefreshScore', '模拟预测评分', '演示数据', 'onCurrentGlucoseInput', '当前实测血糖（可选）', 'onHunger', '当前饱腹感']) {
    assert.doesNotMatch(template, new RegExp(stale))
  }
})
