const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')

/** 跨 vm 上下文的对象原型不同，deepEqual 会误判，统一比 JSON 文本。 */
function json(value) {
  return JSON.stringify(value)
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function makeWx(state) {
  return {
    showToast: (item) => state.toasts.push(item),
    showModal: (item) => {
      state.modals.push(item)
      const confirm = state.confirmNext !== false
      if (item && item.success) item.success({ confirm, cancel: !confirm })
    },
    stopPullDownRefresh: () => {
      state.pullDownStops += 1
    },
    getStorageSync: () => 'token',
    setStorageSync() {},
    removeStorageSync() {}
  }
}

/** 一页记忆的默认夹具：两类共 3 条，其中 diet_taboo 有两条（V63 之后一类可多条）。 */
const DEFAULT_ROWS = [
  { id: 1, memoryKey: 'diet_taboo', memoryText: '最近不能吃香菜', confidence: 85, updatedAt: '2026-11-17T09:12:33' },
  { id: 2, memoryKey: 'diet_taboo', memoryText: '海鲜过敏', confidence: 80, updatedAt: '2026-11-16T09:12:33' },
  { id: 3, memoryKey: 'unknown_key', memoryText: '未来的新类型', confidence: 70, updatedAt: '2026-11-16T08:00:00' }
]

/**
 * 加载「小语记住的事」页。
 */
function createMemoryPage(options = {}) {
  let definition
  const state = { calls: [], toasts: [], modals: [], pullDownStops: 0, confirmNext: true }
  const api = {
    fetchAiMemories: (params) =>
      Promise.resolve({ records: DEFAULT_ROWS, total: DEFAULT_ROWS.length, pageNum: (params && params.pageNum) || 1 }),
    deleteAiMemoryById: () => Promise.resolve({ deleted: 1 }),
    deleteAiMemoriesByKey: () => Promise.resolve({ deleted: 2 }),
    deleteAllAiMemories: () => Promise.resolve({ deleted: 3 }),
    ...options.api
  }
  const record = (name, fn, args) => {
    state.calls.push({ name, args })
    return fn(...args)
  }
  const apiStub = {
    fetchAiMemories: (...args) => record('fetchAiMemories', api.fetchAiMemories, args),
    deleteAiMemoryById: (...args) => record('deleteAiMemoryById', api.deleteAiMemoryById, args),
    deleteAiMemoriesByKey: (...args) => record('deleteAiMemoriesByKey', api.deleteAiMemoriesByKey, args),
    deleteAllAiMemories: (...args) => record('deleteAllAiMemories', api.deleteAllAiMemories, args)
  }
  const dependencies = {
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../services/api': apiStub
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/ai-memory/ai-memory.js'), 'utf8'), {
    Page(value) {
      definition = value
    },
    wx: makeWx(state),
    getApp: () => ({ globalData: {} }),
    require: (name) => {
      assert.ok(dependencies[name], name)
      return dependencies[name]
    },
    setTimeout,
    clearTimeout,
    console,
    Map
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value, callback) {
      Object.assign(this.data, value)
      if (callback) callback()
    }
  }
  return { page, state }
}

function calls(state, name) {
  return state.calls.filter((item) => item.name === name)
}

test('首屏加载：按类分组、同类多条都保留、时间截到分钟', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  // 分页参数必须显式传，否则后端按默认值返回、前端算不出下一页
  assert.equal(json(calls(state, 'fetchAiMemories')[0].args[0]), json({ pageNum: 1, pageSize: 20 }))
  assert.equal(page.data.groups.length, 2)
  assert.equal(page.data.groups[0].key, 'diet_taboo')
  assert.equal(page.data.groups[0].label, '饮食忌口')
  assert.equal(page.data.groups[0].count, 2)
  assert.equal(json(page.data.groups[0].items), json([
    { id: 1, text: '最近不能吃香菜', timeText: '2026-11-17 09:12' },
    { id: 2, text: '海鲜过敏', timeText: '2026-11-16 09:12' }
  ]))
  // 未知键不丢数据，退回原始键名，便于发现「后端加了新类型而前端没跟上」
  assert.equal(page.data.groups[1].label, 'unknown_key')
  assert.equal(page.data.loaded, 3)
  assert.equal(page.data.hasMore, false)
  assert.equal(page.data.error, '')
})

test('空列表：进空态而不是错误态', async () => {
  const { page } = createMemoryPage({ api: { fetchAiMemories: () => Promise.resolve({ records: [], total: 0 }) } })
  page.onShow()
  await flush()

  assert.equal(page.data.groups.length, 0)
  assert.equal(page.data.loaded, 0)
  assert.equal(page.data.error, '')
  assert.equal(page.data.loading, false)
})

test('删除单条：确认后按 id 调接口，只移除那一条，同类其他条目还在', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onDeleteTap({ currentTarget: { dataset: { id: 2 } } })
  await flush()

  assert.equal(state.modals.length, 1)
  assert.equal(json(calls(state, 'deleteAiMemoryById').map((item) => item.args[0])), json([2]))
  assert.equal(page.data.groups[0].count, 1)
  assert.equal(json(page.data.groups[0].items.map((item) => item.id)), json([1]))
  assert.equal(state.toasts.at(-1).title, '已删除')
})

test('删除单条：取消二次确认时不调接口、列表不变', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()
  state.confirmNext = false

  page.onDeleteTap({ currentTarget: { dataset: { id: 1 } } })
  await flush()

  assert.equal(calls(state, 'deleteAiMemoryById').length, 0)
  assert.equal(page.data.loaded, 3)
})

test('清空本类：按 key 调接口，只移除该类，其他类保留', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onClearGroup({ currentTarget: { dataset: { key: 'diet_taboo' } } })
  await flush()

  assert.equal(state.modals.length, 1)
  assert.equal(json(calls(state, 'deleteAiMemoriesByKey').map((item) => item.args[0])), json(['diet_taboo']))
  assert.equal(json(page.data.groups.map((group) => group.key)), json(['unknown_key']))
  assert.equal(state.toasts.at(-1).title, '已清空')
})

test('清空全部：确认后调接口并清空分组', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(calls(state, 'deleteAllAiMemories').length, 1)
  assert.equal(page.data.groups.length, 0)
  assert.equal(page.data.total, 0)
  assert.equal(state.toasts.at(-1).title, '已清空')
})

test('清空全部：一条都没有时不弹确认框', async () => {
  const { page, state } = createMemoryPage({ api: { fetchAiMemories: () => Promise.resolve({ records: [], total: 0 }) } })
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(state.modals.length, 0)
  assert.equal(calls(state, 'deleteAllAiMemories').length, 0)
})

test('触底分页：还有下一页时追加，没有更多时不再请求', async () => {
  let page1 = true
  const { page, state } = createMemoryPage({
    api: {
      fetchAiMemories: (params) => {
        if (params.pageNum === 1) {
          return Promise.resolve({ records: DEFAULT_ROWS, total: 4, pageNum: 1 })
        }
        const hasNext = page1
        page1 = false
        return Promise.resolve({
          records: hasNext
            ? [{ id: 4, memoryKey: 'habit', memoryText: '晚饭后散步', confidence: 90, updatedAt: '2026-11-15T20:00:00' }]
            : [],
          total: 4,
          pageNum: 2
        })
      }
    }
  })
  page.onShow()
  await flush()
  assert.equal(page.data.hasMore, true)

  page.onReachBottom()
  await flush()

  assert.equal(json(calls(state, 'fetchAiMemories').map((item) => item.args[0].pageNum)), json([1, 2]))
  assert.equal(page.data.loaded, 4)
  assert.equal(page.data.hasMore, false)

  // 已经没有更多：再触底不应再发请求
  page.onReachBottom()
  await flush()
  assert.equal(calls(state, 'fetchAiMemories').length, 2)
})

test('加载失败：给出错误态，重试成功后清掉错误', async () => {
  let attempt = 0
  const { page } = createMemoryPage({
    api: {
      fetchAiMemories: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(new Error('网络异常'))
        return Promise.resolve({
          records: [{ id: 9, memoryKey: 'habit', memoryText: '晚饭后散步', confidence: 90, updatedAt: '2026-11-17T20:00:00' }],
          total: 1
        })
      }
    }
  })
  page.onShow()
  await flush()

  assert.equal(page.data.error, '网络异常')
  assert.equal(page.data.loaded, 0)

  page.onRetry()
  await flush()

  assert.equal(page.data.error, '')
  assert.equal(page.data.groups.length, 1)
  assert.equal(page.data.groups[0].label, '生活习惯')
})

test('下拉刷新：重新拉取并收起刷新动画', async () => {
  const { page, state } = createMemoryPage()
  page.onPullDownRefresh()
  await flush()

  assert.equal(calls(state, 'fetchAiMemories').length, 1)
  assert.equal(state.pullDownStops, 1)
})
