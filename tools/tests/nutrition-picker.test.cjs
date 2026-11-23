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
          fetchFoodDetail: async () => food
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
  page.data.searchResults = [food]
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
