const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageDirectory = path.resolve(__dirname, '../../pages/food-analysis')
const pageSource = fs.readFileSync(path.join(pageDirectory, 'food-analysis.js'), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const identifiedMeal = () => ({
  items: [{ foodName: '米饭', foodId: 12, libraryFoodId: 88, categoryCode: 1, weightG: 100,
    carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY', confidence: 96,
    needsConfirmation: false }],
  matchedCount: 1, newFoodsCount: 0, warnings: [], model: 'test-vision',
  analysisToken: 'tok-1', needsConfirmation: false
})

const lowConfidenceMeal = () => ({
  items: [{ foodName: '米饭', foodId: 12, libraryFoodId: 88, categoryCode: 1, weightG: 100,
    carbsPer100g: 25, caloriesPer100g: 116, nutritionSource: 'LIBRARY', confidence: 42,
    needsConfirmation: true }],
  matchedCount: 1, newFoodsCount: 0, warnings: [], model: 'test-vision',
  analysisToken: 'tok-low', needsConfirmation: true
})

function createPage(options = {}) {
  let definition
  // 分析卡片用 400ms 防抖；测试里用假定时器避免真实等待与遗留句柄
  let timerSeq = 0
  const timers = new Map()
  const calls = { analysis: 0, upload: 0, payloads: [], previews: [], glucoseQueries: [],
    foodQueries: [], records: [], toasts: [], modals: [], switchTabs: [], redirects: [], navigations: [], setDataKeys: [] }
  const modules = {
    '../../services/api': {
      analyzeMealPhoto: async (payload) => {
        calls.analysis++
        const result = options.analyze ? options.analyze(calls.analysis, payload) : identifiedMeal()
        if (result instanceof Error) throw result
        return result
      },
      saveMealRecord: async (payload) => {
        calls.payloads.push(payload)
        if (options.saveFail) throw options.saveFail
        return { id: '9', analysisStatus: 'PENDING' }
      },
      // 3e：适食分析只做展示，失败不应阻塞保存
      previewMealSuitability: async (payload) => {
        calls.previews.push(payload)
        if (options.previewFail) throw options.previewFail
        return options.previewResult || {
          tier: 'MODERATE', tierLabel: '升糖负担中等', ruleVersion: '2026.11.1-placeholder',
          worstRuleCode: 'GI_HIGH',
          items: [{ foodId: 12, foodName: '米饭', tier: 'HIGH', tierLabel: '升糖负担较高',
            ruleCode: 'GI_HIGH', categoryCode: 1, giValue: 88, libraryStatus: 'MATCHED',
            nutritionSource: 'LIBRARY' }],
          disclaimer: '结果仅供参考，不构成医疗建议。'
        }
      },
      // 3e：血糖上下文只读，餐前/餐后各取一条最新记录
      fetchGlucoseRecords: async (params) => {
        calls.glucoseQueries.push(params)
        if (options.glucosePages) return options.glucosePages(params)
        const isBefore = String(params.nodeCode || '').indexOf('before_') === 0
        if (isBefore) {
          return options.glucose != null ? { records: [{ value: options.glucose, nodeCode: params.nodeCode }] } : { records: [] }
        }
        return options.afterGlucose != null ? { records: [{ value: options.afterGlucose, nodeCode: params.nodeCode }] } : { records: [] }
      },
      // 添加食物抽屉：直接搜索营养库，不再跳转 nutrition 选择页
      fetchFoods: async (params) => {
        calls.foodQueries.push(params)
        if (options.foodsFail) throw new Error('load failed')
        return options.foodResults || { records: [
          { id: 5, name: '馒头', categoryCode: 1, carbs: 47, cal: 230, gi: 88 }
        ] }
      }
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
    '../../utils/shot': {
      readShotImage: () => (options.imagePath === null ? '' : (options.imagePath || 'meal-photo.jpg')),
      clearShotImage() {}
    },
    '../../utils/media': {
      uploadMealImage: async () => {
        calls.upload++
        if (options.uploadFail && calls.upload === 1) throw new Error('上传失败，请重试')
        return { id: 7 }
      }
    },
    '../../utils/request': { getToken: () => 'test-token' },
    // 按菜分组是纯函数，直接复用真实实现（测的是页面接线，不是分组逻辑本身）
    '../../utils/meal-dish': require('../../utils/meal-dish'),
    '../../utils/record-window': { getNodeRecordWindow: () => ({ locked: false }) },
    '../../utils/constants': require('../../utils/constants')
  }
  vm.runInNewContext(pageSource, {
    Page: (page) => { definition = page },
    require: (name) => {
      if (!(name in modules)) throw new Error('Unexpected dependency: ' + name)
      return modules[name]
    },
    wx: {
      showModal: (...args) => calls.modals.push(args),
      showToast: (...args) => calls.toasts.push(args),
      navigateTo: (...args) => calls.navigations.push(args),
      navigateBack() {},
      setNavigationBarTitle() {},
      showLoading() {},
      hideLoading() {},
      switchTab: (...args) => calls.switchTabs.push(args),
      redirectTo: (...args) => calls.redirects.push(args)
    },
    setTimeout: (fn) => { timerSeq += 1; timers.set(timerSeq, fn); return timerSeq },
    clearTimeout: (id) => { timers.delete(id) },
    console
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (update) {
    for (const [key, value] of Object.entries(update)) {
      calls.setDataKeys.push(key)
      const segments = key.split('.')
      let target = this.data
      for (const segment of segments.slice(0, -1)) target = target[segment]
      target[segments.at(-1)] = value
    }
  }
  return { page, calls }
}

test('识别成功进入 ready，并保留分析令牌与逐项置信信息', async () => {
  const { page, calls } = createPage({ glucose: 5.6 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.phase, 'ready')
  assert.equal(page.data.analysisToken, 'tok-1')
  assert.equal(page.data.needsConfirmation, false)
  assert.equal(page.data.items.length, 1)
  // 3d 的逐项确认依赖这些字段，3b 起不能再丢
  assert.equal(page.data.items[0].confidence, 96)
  assert.equal(page.data.items[0].libraryFoodId, 88)
  assert.equal(page.data.items[0].needsConfirmation, false)
  assert.equal(page.data.analysisReady, true)
  assert.equal(page.data.carbsG, 25)
  assert.equal(page.data.mealSummaryText, '识别 1 种食物')
  assert.equal(page.data.foodNamesText, '米饭')
  assert.equal(page.data.currentGlucose, '5.6')
})

test('照片缺失时停留在 idle，不发起上传与识别', async () => {
  const { page, calls } = createPage({ imagePath: null })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.phase, 'idle')
  assert.equal(calls.upload, 0)
  assert.equal(calls.analysis, 0)
  assert.equal(page.data.analysisReady, false)
})

test('上传失败进入 recognize_failed，可重试恢复', async () => {
  const { page, calls } = createPage({ uploadFail: true })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.phase, 'recognize_failed')
  assert.match(page.data.errorMessage, /上传失败/)
  await page.onRetry()
  await flush()
  assert.equal(page.data.phase, 'ready')
  assert.equal(calls.analysis, 1)
})

test('识别业务失败进入 recognize_failed 并透出后端文案', async () => {
  const error = new Error('未识别出餐食，请重新拍摄清晰照片')
  error.code = 40001
  const { page } = createPage({ analyze: () => error })
  await page.onLoad({ nodeId: 'lunch', nodeName: '%E5%8D%88%E9%A4%90' })
  await flush()
  assert.equal(page.data.phase, 'recognize_failed')
  assert.equal(page.data.errorMessage, '未识别出餐食，请重新拍摄清晰照片')
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.analysisReady, false)
  assert.equal(page.data.nodeName, '午餐')
})

test('识别结果为空进入 empty 且不可保存', async () => {
  const { page, calls } = createPage({ analyze: () => ({ items: [], warnings: [], model: 'test-vision' }) })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.phase, 'empty')
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.analysisReady, false)
  await page.onSave()
  assert.equal(calls.payloads.length, 0)
})

test('保存携带识别令牌与确认标记，成功后跳历史看板', async () => {
  const { page, calls } = createPage({ glucose: 5.6 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.onSave()
  await flush()
  assert.equal(calls.payloads.length, 1)
  const payload = calls.payloads[0]
  for (const key of ['predictNow', 'predictSuggest', 'suggestText', 'algorithmVersion', 'recommendationStatus']) {
    assert.equal(key in payload, false, '不应携带预测字段 ' + key)
  }
  assert.equal(payload.analysisToken, 'tok-1')
  assert.equal(payload.confirmLowConfidence, true)
  assert.equal(payload.nodeCode, 'breakfast')
  assert.equal(payload.items.length, 1)
  assert.equal(payload.items[0].foodName, '米饭')
  assert.equal(payload.items[0].weightG, 100)
  const mealCache = calls.records.find((record) => record[1] && record[1].type === 'meal')
  // 预测下线后本地缓存不再写入任何预测字段
  assert.equal('predictedGlucose' in mealCache[1], false)
  assert.equal('suggestedGlucose' in mealCache[1], false)
  assert.equal(calls.switchTabs.length, 0)
  assert.equal(calls.redirects.at(-1)[0].url, '/pages/stats/stats')
})

test('补充说明只随保存提交，不再作废分析结果', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onSupplementInput({ detail: { value: '只吃了半碗' } })
  assert.equal(page.data.supplement, '只吃了半碗')
  assert.equal(page.data.analysisReady, true)
  assert.equal(typeof page.onReAnalyze, 'undefined')
  await page.onSave()
  await flush()
  assert.equal(calls.payloads.length, 1)
  assert.equal(calls.payloads[0].supplementText, '只吃了半碗')
})

test('改克重后按每 100g 重算并刷新指标', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '200' } })
  assert.equal(page.data.items[0].weightG, 200)
  assert.equal(page.data.items[0].carbsG, 50)
  assert.equal(page.data.items[0].caloriesKcal, 232)
  assert.equal(page.data.carbsG, 50)
  assert.equal(page.data.analysisReady, true)
})

test('改名清空库引用并标记人工修正', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onRenameItem({ currentTarget: { dataset: { index: 0 } } })
  const modal = calls.modals.at(-1)[0]
  assert.equal(modal.editable, true)
  modal.success({ confirm: true, content: '杂粮饭' })
  const item = page.data.items[0]
  assert.equal(item.foodName, '杂粮饭')
  assert.equal(item.foodId, null)
  assert.equal(item.libraryFoodId, null)
  assert.equal(item.userCorrected, true)
  assert.equal(item.sourceText, '已人工修正')
})

test('份量步进器以识别克重为基准，每次 ±0.5 份', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.items[0].portionValue, '1')
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: 0.5 } } })
  assert.equal(page.data.items[0].weightInput, '150')
  assert.equal(page.data.items[0].portionValue, '1.5')
  assert.equal(page.data.items[0].carbsG, 37.5)
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: 0.5 } } })
  assert.equal(page.data.items[0].weightInput, '200')
  assert.equal(page.data.items[0].carbsG, 50)
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: -0.5 } } })
  assert.equal(page.data.items[0].weightInput, '150')
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: -0.5 } } })
  assert.equal(page.data.items[0].weightInput, '100')
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: -0.5 } } })
  assert.equal(page.data.items[0].weightInput, '50')
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: -0.5 } } })
  assert.equal(page.data.items[0].weightInput, '50')
  assert.equal(page.data.items[0].portionValue, '0.5')
})

test('缺少基准克重时步进器置灰并提示先填克重', async () => {
  const meal = identifiedMeal()
  meal.items[0] = { ...meal.items[0], weightG: null }
  const { page, calls } = createPage({ analyze: () => meal })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.items[0].baseWeight, '')
  assert.equal(page.data.items[0].portionDisabled, true)
  assert.equal(page.data.analysisReady, false)
  page.onPortionStep({ currentTarget: { dataset: { index: 0, delta: 0.5 } } })
  assert.match(calls.toasts.at(-1)[0].title, /克重/)
})

test('点克数进入手输，份数随克重自动重算', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onOpenWeightEdit({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.gramEditingIndex, 0)
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '250' } })
  assert.equal(page.data.items[0].portionValue, '2.5')
  page.onWeightBlur({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.gramEditingIndex, -1)
})

test('删除最后一项回到 empty 态', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  // 删除入口先弹二次确认，真正移除在确认后执行
  page.removeItemAt(0)
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.phase, 'empty')
  assert.equal(page.data.analysisReady, false)
})

test('从食物库添加：抽屉搜索后追加并保留默认 100g', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onOpenAddSheet()
  assert.equal(page.data.addSheetVisible, true)
  page.setData({ addKeyword: '馒头' })
  page.searchFoods('馒头')
  await flush()
  assert.equal(calls.foodQueries.at(-1).keyword, '馒头')
  assert.equal(page.data.addResults.length, 1)
  assert.match(page.data.addResults[0].per100Text, /碳水 47g/)
  page.onAddResultTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.addSheetVisible, false)
  assert.equal(page.data.items.length, 2)
  const added = page.data.items[1]
  assert.equal(added.foodName, '馒头')
  assert.equal(added.weightInput, '100')
  assert.equal(added.nutritionSource, 'LIBRARY')
  assert.equal(added.carbsG, 47)
  assert.equal(page.data.carbsG, 72)
})

test('换食物保留原克重并替换营养', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '180' } })
  page.onReplaceItem({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.addSheetVisible, true)
  assert.equal(page.data.addReplacing, true)
  page.applyPickedFood({ id: 9, name: '糙米饭', categoryCode: 1, carbs: 23, cal: 112, gi: 68 })
  const item = page.data.items[0]
  assert.equal(item.foodName, '糙米饭')
  assert.equal(item.weightInput, '180')
  assert.equal(item.carbsG, 41.4)
  assert.equal(item.userCorrected, true)
  assert.equal(page.data.addSheetVisible, false)
})

test('手动添加营养留空：可保存、不计入总量', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onOpenAddSheet()
  page.onSwitchAddMode({ currentTarget: { dataset: { mode: 'custom' } } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '自制沙拉' } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'weight' } }, detail: { value: '150' } })
  page.onConfirmAdd()
  const added = page.data.items[1]
  assert.equal(added.foodName, '自制沙拉')
  assert.equal(added.nutritionKnown, false)
  assert.equal(page.data.analysisReady, true)
  assert.equal(page.data.nutritionUnknownCount, 1)
  // 总量只统计已知项（米饭 25g）
  assert.equal(page.data.carbsG, 25)
  await page.onSave()
  await flush()
  const payload = calls.payloads.at(-1)
  assert.equal(payload.items.length, 2)
  assert.equal(payload.items[1].nutritionSource, 'UNKNOWN')
  assert.equal(payload.items[1].carbsG, null)
})

test('手动添加并填写营养后计入总量', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onOpenAddSheet()
  page.onSwitchAddMode({ currentTarget: { dataset: { mode: 'custom' } } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '全麦面包' } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'weight' } }, detail: { value: '50' } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'carbs' } }, detail: { value: '40' } })
  page.onAddFormInput({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '240' } })
  page.onConfirmAdd()
  assert.equal(page.data.items[1].nutritionKnown, true)
  assert.equal(page.data.items[1].carbsG, 20)
  assert.equal(page.data.carbsG, 45)
  assert.equal(page.data.nutritionUnknownCount, 0)
})

test('重量越界或达 50 项上限时拒绝保存/添加', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '6000' } })
  assert.equal(page.data.analysisReady, false)
  page.onWeightInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '100' } })
  page.setData({ items: new Array(50).fill(page.data.items[0]) })
  page.onOpenAddSheet()
  page.onSwitchAddMode({ currentTarget: { dataset: { mode: 'custom' } } })
  assert.equal(page.data.addSheetVisible, false)
  assert.match(calls.toasts.at(-1)[0].title, /50/)
})

test('语音确认只写入备注，不打断当前分析', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onOpenSpeechInput()
  assert.equal(page.data.speechVisible, true)
  page.onSpeechConfirm({ detail: { text: '只吃了半碗' } })
  assert.equal(page.data.speechVisible, false)
  assert.equal(page.data.supplement, '只吃了半碗')
  assert.equal(page.data.analysisReady, true)
  assert.equal('needsReanalysis' in page.data, false)
})

test('保存载荷补齐六字段供低置信对齐使用', async () => {
  const { page, calls } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.onSave()
  await flush()
  const item = calls.payloads.at(-1).items[0]
  assert.equal(item.foodId, 12)
  assert.equal(item.libraryFoodId, 88)
  assert.equal(item.categoryCode, 1)
  assert.equal(item.nutritionSource, 'LIBRARY')
  assert.equal(item.confidence, 96)
  assert.equal(item.userCorrected, false)
})

test('低置信项默认未确认并阻止保存，勾选后放行', async () => {
  const { page, calls } = createPage({ analyze: () => lowConfidenceMeal() })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.items[0].needsConfirmation, true)
  assert.equal(page.data.items[0].confirmed, false)
  assert.equal(page.data.pendingConfirmCount, 1)
  await page.onSave()
  assert.equal(calls.payloads.length, 0)
  page.onToggleConfirm({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.items[0].confirmed, true)
  assert.equal(page.data.pendingConfirmCount, 0)
  await page.onSave()
  await flush()
  const payload = calls.payloads.at(-1)
  assert.equal(payload.analysisToken, 'tok-low')
  assert.equal(payload.confirmLowConfidence, true)
})

test('40001 后端文案在保存按钮下方回显且不清空输入', async () => {
  const error = new Error('存在未确认的低置信项：米饭，请确认后重试')
  error.code = 40001
  const { page, calls } = createPage({ saveFail: error })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.onSave()
  await flush()
  assert.equal(page.data.saveError, '存在未确认的低置信项：米饭，请确认后重试')
  assert.equal(page.data.items.length, 1)
  assert.equal(page.data.phase, 'ready')
  assert.equal(calls.redirects.length, 0)
  assert.equal(calls.toasts.length, 0)
})

test('无识别令牌时不发送令牌与确认字段', async () => {
  const { page, calls } = createPage({
    analyze: () => ({ ...identifiedMeal(), analysisToken: null, needsConfirmation: false })
  })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.onSave()
  await flush()
  const payload = calls.payloads.at(-1)
  assert.equal('analysisToken' in payload, false)
  assert.equal('confirmLowConfidence' in payload, false)
})

test('适食分析请求携带食物字段，响应写入档位/单项/规则版本/免责声明', async () => {
  const meal = identifiedMeal()
  meal.items = [{ ...meal.items[0], giValue: 88, libraryStatus: 'MATCHED' }]
  const { page, calls } = createPage({ analyze: () => meal })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.loadPreview()
  assert.equal(calls.previews.length, 1)
  const request = calls.previews[0]
  assert.equal(request.nodeCode, 'breakfast')
  const item = request.items[0]
  assert.equal(item.foodId, 12)
  assert.equal(item.libraryFoodId, 88)
  assert.equal(item.foodName, '米饭')
  assert.equal(item.categoryCode, 1)
  assert.equal(item.weightG, 100)
  assert.equal(item.carbsG, 25)
  assert.equal(item.caloriesKcal, 116)
  assert.equal(item.giValue, 88)
  assert.equal(item.nutritionSource, 'LIBRARY')
  assert.equal(item.confidence, 96)
  assert.equal(item.userCorrected, false)
  assert.equal(item.libraryStatus, 'MATCHED')
  assert.equal(page.data.preview.tier, 'MODERATE')
  assert.equal(page.data.preview.tierLabel, '升糖负担中等')
  assert.equal(page.data.preview.ruleVersion, '2026.11.1-placeholder')
  assert.equal(page.data.preview.items[0].tierLabel, '升糖负担较高')
  assert.equal(page.data.preview.disclaimer, '结果仅供参考，不构成医疗建议。')
  assert.equal(page.data.previewLoading, false)
  assert.equal(page.data.previewError, '')
})

test('分析卡生成三档计数、结论说明与逐项建议兜底', async () => {
  const { page } = createPage()
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.loadPreview()
  assert.equal(page.data.tierCounts.LOW, 0)
  assert.equal(page.data.tierCounts.MODERATE, 0)
  assert.equal(page.data.tierCounts.HIGH, 1)
  assert.equal(page.data.tierCounts.UNKNOWN, 0)
  assert.match(page.data.analysisSub, /控制份量/)
  assert.equal(page.data.adviceItems[0].adviceText, '升糖负担较高，建议减少份量或替换为升糖负担更低的食物')
  assert.equal(page.data.adviceTitle, '逐项建议')
  assert.equal(page.data.adviceToggleLabel, '展开 1 项')
  assert.equal(page.data.adviceOpen, false)
  page.onToggleAdvice()
  assert.equal(page.data.adviceOpen, true)
  assert.equal(page.data.adviceToggleLabel, '收起')
  page.onFilterTier({ currentTarget: { dataset: { tier: 'LOW' } } })
  assert.equal(page.data.rateFilter, 'LOW')
  assert.equal(page.data.adviceOpen, true)
  assert.equal(page.data.adviceItems.length, 0)
  assert.equal(page.data.adviceEmptyText, '没有该档位的食物')
  assert.equal(page.data.adviceTitle, '逐项建议 · 负担较低')
  page.onClearFilter()
  assert.equal(page.data.rateFilter, '')
  assert.equal(page.data.adviceItems.length, 1)
})

test('逐项建议优先使用后端 adviceText', async () => {
  const { page } = createPage({ previewResult: {
    tier: 'MODERATE', tierLabel: '升糖负担中等', ruleVersion: '2026.11.2', worstRuleCode: 'CAT1_STAPLE_MODERATE',
    items: [{ foodId: 12, foodName: '米饭', tier: 'MODERATE', tierLabel: '升糖负担中等',
      ruleCode: 'CAT1_STAPLE_MODERATE', adviceText: '建议控制在半碗左右' }],
    disclaimer: '结果仅供参考，不构成医疗建议。'
  } })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.loadPreview()
  assert.equal(page.data.adviceItems[0].adviceText, '建议控制在半碗左右')
  assert.equal(page.data.tierCounts.LOW, 0)
  assert.equal(page.data.tierCounts.MODERATE, 1)
  assert.equal(page.data.tierCounts.HIGH, 0)
  assert.equal(page.data.tierCounts.UNKNOWN, 0)
})

test('分析失败只回显提示，不影响保存', async () => {
  const { page, calls } = createPage({ previewFail: new Error('分析服务暂时不可用') })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  await page.loadPreview()
  assert.equal(page.data.preview, null)
  assert.equal(page.data.previewError, '分析服务暂时不可用')
  assert.equal(page.data.previewLoading, false)
  await page.onSave()
  await flush()
  assert.equal(calls.payloads.length, 1)
  assert.equal(calls.redirects.at(-1)[0].url, '/pages/stats/stats')
})

test('血糖上下文按餐前餐后组合并计算差值', async () => {
  const { page, calls } = createPage({ glucose: 5.6, afterGlucose: 8.1 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  const queried = calls.glucoseQueries.map((query) => query.nodeCode).sort()
  assert.deepEqual(queried, ['after_breakfast', 'before_breakfast'])
  assert.equal(page.data.glucoseContext.before, 5.6)
  assert.equal(page.data.glucoseContext.after, 8.1)
  assert.equal(page.data.glucoseContext.delta, 2.5)
  assert.equal(page.data.glucoseNodes[0].label, '餐前')
  assert.equal(page.data.glucoseNodes[0].nodeCode, 'before_breakfast')
  assert.equal(page.data.glucoseNodes[1].label, '餐后')
  // 餐后必须是非餐点血糖节点 after_*，餐点节点不接受血糖记录
  assert.equal(page.data.glucoseNodes[1].nodeCode, 'after_breakfast')
  assert.equal(page.data.glucoseNodes[1].nodeName, '早餐后')
  assert.equal(page.data.currentGlucose, '5.6')
  assert.equal(page.data.glucoseLoading, false)
})

test('血糖卡展示记录时间，取现有接口返回时间', async () => {
  const { page } = createPage({ glucosePages: (params) => ({
    records: [{ value: String(params.nodeCode).indexOf('before_') === 0 ? 5.6 : 8.1,
      recordedAt: '2026-10-19T07:32:00' }]
  }) })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.glucoseNodes[0].time, '07:32')
  assert.equal(page.data.glucoseNodes[1].time, '07:32')
  assert.equal(page.data.glucoseContext.delta, 2.5)
})

test('缺少餐后记录时保留餐前值、差值置空', async () => {
  const { page } = createPage({ glucose: 5.6 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  assert.equal(page.data.glucoseContext.before, 5.6)
  assert.equal(page.data.glucoseContext.after, null)
  assert.equal(page.data.glucoseContext.delta, null)
  assert.equal(page.data.glucoseNodes[1].value, null)
})

test('血糖补录先进入血糖拍照流程，页面内不再写入血糖', async () => {
  const { page, calls } = createPage({ glucose: 5.6 })
  await page.onLoad({ nodeId: 'breakfast' })
  await flush()
  page.onGoMeasure({ currentTarget: { dataset: { node: 'before_breakfast' } } })
  const url = calls.navigations.at(-1)[0].url
  assert.match(url, /^\/pages\/camera\/camera\?nodeId=before_breakfast&nodeName=/)
  const nodeName = decodeURIComponent(url.split('nodeName=')[1])
  assert.equal(nodeName, '早餐前')
  page.onGoMeasure({ currentTarget: { dataset: { node: 'after_breakfast' } } })
  const afterUrl = calls.navigations.at(-1)[0].url
  assert.match(afterUrl, /^\/pages\/camera\/camera\?nodeId=after_breakfast&nodeName=/)
  assert.equal(decodeURIComponent(afterUrl.split('nodeName=')[1]), '早餐后')
  // 默认节点回落到本餐餐前，不再使用页面内血糖输入
  page.onGoMeasure({ currentTarget: { dataset: {} } })
  assert.match(calls.navigations.at(-1)[0].url, /nodeId=before_breakfast/)
  assert.equal(typeof page.onConfirmGlucose, 'undefined')
  assert.equal(typeof page.onGlucoseInput, 'undefined')
})
