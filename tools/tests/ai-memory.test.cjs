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

/** 一页记忆的默认夹具：两类共 3 条，其中 diet_taboo 有两条（一类可多条）。 */
const DEFAULT_ROWS = [
  { id: 1, memoryKey: 'diet_taboo', memoryText: '最近不能吃香菜', confidence: 85, updatedAt: '2026-11-17T09:12:33' },
  { id: 2, memoryKey: 'diet_taboo', memoryText: '海鲜过敏', confidence: 80, updatedAt: '2026-11-16T09:12:33' },
  { id: 3, memoryKey: 'unknown_key', memoryText: '未来的新类型', confidence: 70, updatedAt: '2026-11-16T08:00:00' }
]

/** 后端每次加载都会带回五类的条数（没有记忆的类是 0）。 */
const DEFAULT_COUNTS = {
  diet_taboo: 2,
  glucose_goal: 0,
  health_context: 0,
  habit: 1,
  preference: 0
}

/** 分类入口的固定顺序：全部 + 五类，不随"哪类先有记忆"跳动。 */
const TILE_KEYS = ['', 'diet_taboo', 'glucose_goal', 'health_context', 'habit', 'preference']

/**
 * 加载「小语记住的事」页。
 */
function createMemoryPage(options = {}) {
  let definition
  const state = { calls: [], toasts: [], modals: [], pullDownStops: 0, confirmNext: true }
  const api = {
    fetchAiMemories: () =>
      Promise.resolve({ records: DEFAULT_ROWS, total: DEFAULT_ROWS.length, pageNum: 1, counts: DEFAULT_COUNTS }),
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

function tileOf(page, key) {
  return page.data.tiles.find((tile) => tile.key === key)
}

test('首屏加载：入口列出全部与五类，条目平铺并带类名标签', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  // 首屏不带 memoryKey：多带一个空串会让后端多一次"等于空"的判断，日志也不干净
  assert.equal(json(calls(state, 'fetchAiMemories')[0].args[0]), json({ pageNum: 1, pageSize: 20, memoryKey: '' }))
  assert.equal(json(page.data.tiles.map((tile) => tile.key)), json(TILE_KEYS))
  // 「全部」的数字是五类之和，而不是当前页的行数
  assert.equal(tileOf(page, '').count, 3)
  assert.equal(tileOf(page, 'diet_taboo').count, 2)
  assert.equal(tileOf(page, 'habit').count, 1)
  assert.equal(tileOf(page, 'preference').count, 0)
  assert.equal(page.data.activeKey, '')
  assert.equal(page.data.showTag, true, '混合列表要标出每条属于哪一类')
  assert.equal(json(page.data.items.map((item) => item.id)), json([1, 2, 3]))
  assert.equal(page.data.items[0].label, '饮食忌口')
  assert.equal(page.data.items[0].timeText, '2026-11-17 09:12')
  assert.equal(page.data.hasMore, false)
  assert.equal(page.data.error, '')
})

test('未知类：不丢数据，退回原始键名', async () => {
  const { page } = createMemoryPage()
  page.onShow()
  await flush()

  assert.equal(page.data.items[2].label, 'unknown_key')
  // 入口只列已知五类；未知类靠列表里的标签暴露出来（后端加了新类型时一眼能看到）
  assert.equal(page.data.tiles.length, 6)
})

test('空列表：进空态，入口仍然六个（没有记忆的类给 0）', async () => {
  const { page } = createMemoryPage({
    api: { fetchAiMemories: () => Promise.resolve({ records: [], total: 0, counts: {} }) }
  })
  page.onShow()
  await flush()

  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.loaded, 0)
  assert.equal(page.data.error, '')
  assert.equal(page.data.tiles.length, 6)
  assert.equal(tileOf(page, '').count, 0)
})

test('点某一类：带 memoryKey 从第一页重取，标题与标签随之切换', async () => {
  const { page, state } = createMemoryPage({
    api: {
      fetchAiMemories: (params) =>
        Promise.resolve(
          params && params.memoryKey
            ? {
                records: [
                  { id: 1, memoryKey: 'diet_taboo', memoryText: '最近不能吃香菜', confidence: 85, updatedAt: '2026-11-17T09:12:33' }
                ],
                total: 1,
                pageNum: 1,
                counts: DEFAULT_COUNTS
              }
            : { records: DEFAULT_ROWS, total: 3, pageNum: 1, counts: DEFAULT_COUNTS }
        )
    }
  })
  page.onShow()
  await flush()

  page.onPickCategory({ currentTarget: { dataset: { key: 'diet_taboo' } } })
  await flush()

  const second = calls(state, 'fetchAiMemories')[1].args[0]
  assert.equal(second.memoryKey, 'diet_taboo')
  assert.equal(second.pageNum, 1, '切分类必须回到第 1 页，否则会从旧页码接着取空页')
  assert.equal(page.data.activeKey, 'diet_taboo')
  assert.equal(page.data.activeLabel, '饮食忌口')
  assert.equal(page.data.showTag, false, '只看某一类时卡片上不再重复类名')
  assert.equal(page.data.items.length, 1)
  // 入口数字不随筛选变化：点进去之后别类的条数仍然在
  assert.equal(tileOf(page, 'diet_taboo').count, 2)
  assert.equal(tileOf(page, 'habit').count, 1)
})

test('再点当前分类不重复请求', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onPickCategory({ currentTarget: { dataset: { key: '' } } })
  await flush()

  assert.equal(calls(state, 'fetchAiMemories').length, 1)
})

test('删除单条：确认后按 id 调接口，条目与入口数字同步减少', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onDeleteTap({ currentTarget: { dataset: { id: 2 } } })
  await flush()

  assert.equal(state.modals.length, 1)
  assert.equal(json(calls(state, 'deleteAiMemoryById').map((item) => item.args[0])), json([2]))
  assert.equal(json(page.data.items.map((item) => item.id)), json([1, 3]))
  assert.equal(tileOf(page, 'diet_taboo').count, 1, '这一类少一条')
  assert.equal(tileOf(page, '').count, 2, '「全部」跟着少一条')
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

test('清空本类：按 key 调接口，只移除该类并把入口归零', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onClearGroup({ currentTarget: { dataset: { key: 'diet_taboo' } } })
  await flush()

  assert.equal(json(calls(state, 'deleteAiMemoriesByKey').map((item) => item.args[0])), json(['diet_taboo']))
  assert.equal(json(page.data.items.map((item) => item.id)), json([3]))
  assert.equal(tileOf(page, 'diet_taboo').count, 0)
  assert.equal(tileOf(page, '').count, 1)
  assert.equal(state.toasts.at(-1).title, '已清空')
})

test('清空全部：确认后调接口，列表与入口全部清零', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(calls(state, 'deleteAllAiMemories').length, 1)
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.total, 0)
  assert.equal(tileOf(page, '').count, 0)
  assert.equal(tileOf(page, 'habit').count, 0)
  assert.equal(state.toasts.at(-1).title, '已清空')
})

test('清空全部：一条都没有时不弹确认框', async () => {
  const { page, state } = createMemoryPage({
    api: { fetchAiMemories: () => Promise.resolve({ records: [], total: 0, counts: {} }) }
  })
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(state.modals.length, 0)
  assert.equal(calls(state, 'deleteAllAiMemories').length, 0)
})

test('触底分页：沿用同一个筛选条件，追加后不再重复请求', async () => {
  let served = 0
  const { page, state } = createMemoryPage({
    api: {
      fetchAiMemories: (params) => {
        served += 1
        if (served === 1) {
          return Promise.resolve({ records: DEFAULT_ROWS, total: 4, pageNum: 1, counts: DEFAULT_COUNTS })
        }
        return Promise.resolve({
          records: [{ id: 4, memoryKey: 'habit', memoryText: '晚饭后散步', confidence: 90, updatedAt: '2026-11-15T20:00:00' }],
          total: 4,
          pageNum: 2,
          counts: DEFAULT_COUNTS
        })
      }
    }
  })
  page.onShow()
  await flush()
  assert.equal(page.data.hasMore, true, 'total 比已加载多，说明还有下一页')

  page.onReachBottom()
  await flush()

  assert.equal(json(calls(state, 'fetchAiMemories').map((item) => item.args[0].pageNum)), json([1, 2]))
  assert.equal(calls(state, 'fetchAiMemories')[1].args[0].memoryKey, '', '翻页不能丢筛选条件')
  assert.equal(page.data.loaded, 4)
  assert.equal(page.data.hasMore, false)

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
          total: 1,
          counts: DEFAULT_COUNTS
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
  assert.equal(page.data.items.length, 1)
  assert.equal(page.data.items[0].label, '生活习惯')
})

test('下拉刷新：重新拉取并收起刷新动画', async () => {
  const { page, state } = createMemoryPage()
  page.onPullDownRefresh()
  await flush()

  assert.equal(calls(state, 'fetchAiMemories').length, 1)
  assert.equal(state.pullDownStops, 1)
})
