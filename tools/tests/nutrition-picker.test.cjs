const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageSource = fs.readFileSync(path.resolve(__dirname, '../../pages/nutrition/nutrition.js'), 'utf8')
const food = { id: 5, name: '馒头', categoryCode: 1, carbs: 47, cal: 230, gi: 88 }

function createPage(options = {}) {
  let definition
  const calls = { emitted: [], modals: [], toasts: [], titles: [], backs: 0 }
  const channel = {
    emit: (name, payload) => calls.emitted.push([name, payload])
  }
  vm.runInNewContext(pageSource, {
    Page: (page) => { definition = page },
    require: (name) => {
      if (name === '../../utils/display') return { applyDisplayToCurrentPage() {} }
      if (name === '../../services/api') {
        return {
          fetchFoodCategories: async () => [],
          fetchFoods: async () => ({ records: [] }),
          fetchFoodDetail: async () => options.food || food
        }
      }
      if (name === '../../utils/food-images') return { getFoodImage: () => '' }
      throw new Error('Unexpected dependency: ' + name)
    },
    wx: {
      showModal: (...args) => calls.modals.push(args),
      showToast: (...args) => calls.toasts.push(args),
      setNavigationBarTitle: (...args) => calls.titles.push(args),
      navigateBack: () => { calls.backs++ },
      stopPullDownRefresh() {}
    },
    console
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = function (update) {
    for (const [key, value] of Object.entries(update)) this.data[key] = value
  }
  page.getOpenerEventChannel = () => (options.noChannel ? null : channel)
  page.data.searchResults = [options.food || food]
  return { page, calls }
}

test('pick=1 进入选择器模式并调整标题', () => {
  const { page, calls } = createPage()
  page.onLoad({ pick: '1' })
  assert.equal(page.data.picking, true)
  assert.equal(calls.titles.at(-1)[0].title, '选择食物')
})

test('选择器模式点击食物回传六字段并返回', () => {
  const { page, calls } = createPage()
  page.onLoad({ pick: '1' })
  page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(calls.emitted.length, 1)
  assert.equal(calls.emitted[0][0], 'foodSelected')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.emitted[0][1])), {
    id: 5, name: '馒头', categoryCode: 1, carbs: 47, cal: 230, gi: 88
  })
  assert.equal(calls.backs, 1)
  assert.equal(calls.modals.length, 0)
})

test('普通模式点击食物仍弹详情，不回传不返回', () => {
  const { page, calls } = createPage()
  page.onLoad({})
  assert.equal(page.data.picking, false)
  page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(calls.emitted.length, 0)
  assert.equal(calls.backs, 0)
  return new Promise((resolve) => setImmediate(resolve)).then(() => {
    assert.equal(calls.modals.length, 1)
    assert.equal(calls.modals[0][0].showCancel, false)
  })
})

test('选择器模式缺少 id 的本地降级数据不返回', () => {
  const { page, calls } = createPage()
  page.onLoad({ pick: '1' })
  page.data.searchResults = [{ name: '本地食物', carbs: 10, cal: 40, gi: null }]
  page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(calls.emitted.length, 0)
  assert.equal(calls.backs, 0)
  assert.match(calls.toasts.at(-1)[0].title, /暂不支持/)
})

test('模拟GI展示时明确标注，选择食物时不回填为真实GI', async () => {
  const simulated = { ...food, gi: null, giDemo: 15 }
  const viewer = createPage({ food: simulated })
  viewer.page.onLoad({})
  viewer.page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(viewer.calls.modals[0][0].content, /模拟 GI 15（仅演示，不用于计算）/)
  const picker = createPage({ food: simulated })
  picker.page.onLoad({ pick: '1' })
  picker.page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(picker.calls.emitted[0][1].gi, null)
  assert.equal(Object.hasOwn(picker.calls.emitted[0][1], 'giDemo'), false)
})

test('有已核对GI时优先展示真实字段，英文保留模拟标记', async () => {
  const { page, calls } = createPage({ food: { ...food, gi: 36, giDemo: 15 } })
  page.onLoad({}); page.onFoodTap({ currentTarget: { dataset: { index: 0 } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(calls.modals[0][0].content, /GI 36/)
  assert.doesNotMatch(calls.modals[0][0].content, /模拟/)
  const catalog = require('../../utils/locales/en')
  assert.equal(catalog.t('模拟 GI 15（仅演示，不用于计算）', 'en'), 'Simulated GI 15 (display only, excluded from calculations)')
})
