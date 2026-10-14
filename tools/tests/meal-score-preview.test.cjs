const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { getMealScorePreview } = require('../../services/meal-score-preview')

const pageDirectory = path.resolve(__dirname, '../../pages/food-analysis')
const pageSource = fs.readFileSync(path.join(pageDirectory, 'food-analysis.js'), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const identifiedMeal = () => ({
  items: [{ foodName: '米饭', foodId: 12, categoryCode: 1, weightG: 100,
    carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY' }],
  matchedCount: 1, newFoodsCount: 0, warnings: [], model: 'test-vision'
})

function createPage(options = {}) {
  let definition
  const calls = { analysis: 0, upload: 0, prediction: 0, payloads: [], records: [], updates: 0 }
  const modules = {
    '../../services/api': {
      analyzeMealPhoto: async () => {
        calls.analysis++
        return options.analyze ? options.analyze(calls.analysis) : identifiedMeal()
      },
      predictMealGlucose: () => { calls.prediction++; throw new Error('真实预测不应调用') },
      saveMealRecord: async (payload) => { calls.payloads.push(payload) }
    },
    '../../services/meal-score-preview': { getMealScorePreview: options.score || getMealScorePreview },
    '../../utils/storage': {
      getTodayKey: () => '2026-10-14', getRecords: () => ({}),
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
  return { page, calls }
}

test('适配入口返回固定模拟分数，不依赖血糖或编造血糖值', async () => {
  assert.equal(await getMealScorePreview({ items: [] }), null)
  const input = { items: [{ foodName: '测试餐食' }], currentGlucose: null }
  const score = await getMealScorePreview(input)
  assert.equal(score.source, 'MOCK')
  assert.equal(score.score, 85)
  assert.equal(score.maxScore, 100)
  assert.match(score.description, /固定模拟数据/)
  assert.equal(score.predictNow, undefined)
  score.score = 0
  assert.equal((await getMealScorePreview(input)).score, 85)
})

test('识别成功自动显示评分，没有实测血糖也不调用真实预测', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.currentGlucose, '')
  assert.equal(page.data.scorePreview.score, 85)
  assert.equal(page.data.scoreLoading, false)
  assert.equal(page.data.analysisReady, true)
  assert.equal(page.data.carbsG, 25)
  assert.equal(calls.prediction, 0)
})

test('份量修改更新真实营养，模拟评分仍标记为展示样例', async () => {
  const { page } = createPage()
  await page.onLoad({})
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  await flush()
  assert.equal(page.data.carbsG, 50)
  assert.equal(page.data.caloriesKcal, 232)
  assert.equal(page.data.scorePreview.source, 'MOCK')
  assert.equal(page.data.scorePreview.score, 85)
})

test('模拟评分可独立展示，但缺失营养/重量仍禁止保存', async () => {
  const { page, calls } = createPage({ analyze: async () => {
    const meal = identifiedMeal()
    meal.items[0].weightG = null
    return meal
  } })
  await page.onLoad({})
  await flush()
  assert.equal(page.data.scorePreview.score, 85)
  assert.equal(page.data.analysisReady, false)
  await page.onSave()
  assert.equal(calls.payloads.length, 0)
})

test('补充信息清除旧分数，重新识别失败不残留分数且复用照片', async () => {
  const { page, calls } = createPage({ analyze: async (attempt) => {
    if (attempt > 1) throw new Error('识别失败')
    return identifiedMeal()
  } })
  await page.onLoad({})
  await flush()
  page.onSupplementInput({ detail: { value: '这是糙米' } })
  assert.equal(page.data.scorePreview, null)
  assert.equal(page.data.needsReanalysis, true)
  await page.onReAnalyze()
  await flush()
  assert.equal(page.data.scorePreview, null)
  assert.equal(page.data.analysisReady, false)
  assert.equal(page.data.analysisError, '识别失败')
  assert.equal(calls.upload, 1)
})

test('保存只提交真实餐食，模拟评分和预测文案不落库/不进入缓存', async () => {
  const { page, calls } = createPage()
  await page.onLoad({})
  await flush()
  // 即使有旧版页面残留的预测状态，也不得把模拟数据拼入保存请求。
  page.data.prediction = { predictNow: 8, predictSuggest: 7, suggestText: '模拟建议' }
  await page.onSave()
  assert.equal(calls.payloads.length, 1)
  const payload = calls.payloads[0]
  assert.equal(payload.mediaId, 7)
  assert.equal(payload.carbsG, 25)
  assert.equal(payload.items[0].foodName, '米饭')
  for (const key of ['score', 'scorePreview', 'predictNow', 'predictSuggest', 'suggestText']) {
    assert.equal(Object.hasOwn(payload, key), false)
  }
  const cached = calls.records[0][1]
  assert.equal(cached.predictedGlucose, null)
  assert.equal(cached.suggestedGlucose, null)
  assert.equal(Object.hasOwn(cached, 'score'), false)
  assert.equal(calls.prediction, 0)
})

test('评分入口异常或无效分数不阻断真实餐食保存', async () => {
  for (const score of [async () => { throw new Error('评分不可用') }, async () => ({ score: 999, maxScore: 100 })]) {
    const { page, calls } = createPage({ score })
    await page.onLoad({})
    await flush()
    assert.equal(page.data.scorePreview, null)
    assert.ok(page.data.scoreError)
    assert.equal(page.data.scoreLoading, false)
    assert.equal(page.data.analysisReady, true)
    await page.onSave()
    assert.equal(calls.payloads.length, 1)
  }
})

test('补充信息变更与退出页面后，异步评分不能回写旧结果', async () => {
  for (const action of ['supplement', 'unload']) {
    let resolveScore
    const { page, calls } = createPage({ score: () => new Promise((resolve) => { resolveScore = resolve }) })
    await page.onLoad({})
    assert.equal(page.data.scoreLoading, true)
    if (action === 'supplement') page.onSupplementInput({ detail: { value: '重新识别' } })
    else page.onUnload()
    const countBefore = calls.updates
    resolveScore({ source: 'MOCK', score: 85, maxScore: 100 })
    await flush()
    assert.equal(calls.updates, countBefore)
    assert.equal(page.data.scorePreview, null)
  }
})

test('评分卡紧随识别状态展示，保留模拟标识且不再绑定真实预测按钮', () => {
  const template = fs.readFileSync(path.join(pageDirectory, 'food-analysis.wxml'), 'utf8')
  assert.ok(template.indexOf('模拟预测评分') < template.indexOf('识别的食物与营养'))
  assert.match(template, /演示数据/)
  assert.match(template, /此分数不写入记录/)
  assert.doesNotMatch(template, /bindtap="onPredict"/)
  assert.match(template, /bindtap="onRefreshScore"/)
})
