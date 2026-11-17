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

/**
 * 加载「小语记住的事」页。
 * api 侧默认返回两条（一条正常键、一条未知键），覆盖「标签映射」与「未知键退回原键名」。
 */
function createMemoryPage(options = {}) {
  let definition
  const state = { calls: [], toasts: [], modals: [], pullDownStops: 0, confirmNext: true }
  const api = {
    fetchAiMemories: () =>
      Promise.resolve({
        records: [
          { memoryKey: 'diet_taboo', memoryText: '最近不能吃香菜', confidence: 85, updatedAt: '2026-11-17T09:12:33' },
          { memoryKey: 'unknown_key', memoryText: '未来的新类型', confidence: 70, updatedAt: '2026-11-16T08:00:00' }
        ]
      }),
    deleteAiMemory: () => Promise.resolve({ deleted: 1 }),
    deleteAllAiMemories: () => Promise.resolve({ deleted: 2 }),
    ...options.api
  }
  const apiStub = {
    fetchAiMemories: () => {
      state.calls.push({ name: 'fetchAiMemories', args: [] })
      return api.fetchAiMemories()
    },
    deleteAiMemory: (key) => {
      state.calls.push({ name: 'deleteAiMemory', args: [key] })
      return api.deleteAiMemory(key)
    },
    deleteAllAiMemories: () => {
      state.calls.push({ name: 'deleteAllAiMemories', args: [] })
      return api.deleteAllAiMemories()
    }
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
    console
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

test('首屏加载：把记忆键映射成中文标签，时间截到分钟', async () => {
  const { page } = createMemoryPage()
  page.onShow()
  await flush()

  assert.equal(page.data.list.length, 2)
  assert.equal(json(page.data.list[0]), json({ key: 'diet_taboo', label: '饮食忌口', text: '最近不能吃香菜', timeText: '2026-11-17 09:12' }))
  // 未知键不丢数据，退回原始键名，便于发现「后端加了新类型而前端没跟上」
  assert.equal(page.data.list[1].label, 'unknown_key')
  assert.equal(page.data.loading, false)
  assert.equal(page.data.error, '')
})

test('空列表：进空态而不是错误态', async () => {
  const { page } = createMemoryPage({ api: { fetchAiMemories: () => Promise.resolve({ records: [] }) } })
  page.onShow()
  await flush()

  assert.equal(page.data.list.length, 0)
  assert.equal(page.data.error, '')
  assert.equal(page.data.loading, false)
})

test('单条删除：确认后按 memoryKey 调接口，并从列表移除', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onDeleteTap({ currentTarget: { dataset: { key: 'diet_taboo' } } })
  await flush()

  assert.equal(state.modals.length, 1)
  assert.equal(json(calls(state, 'deleteAiMemory').map((item) => item.args[0])), json(['diet_taboo']))
  assert.equal(json(page.data.list.map((item) => item.key)), json(['unknown_key']))
  assert.equal(state.toasts.at(-1).title, '已删除')
})

test('单条删除：取消二次确认时不调接口、列表不变', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()
  state.confirmNext = false

  page.onDeleteTap({ currentTarget: { dataset: { key: 'diet_taboo' } } })
  await flush()

  assert.equal(calls(state, 'deleteAiMemory').length, 0)
  assert.equal(page.data.list.length, 2)
})

test('清空全部：确认后调接口并清空列表', async () => {
  const { page, state } = createMemoryPage()
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(calls(state, 'deleteAllAiMemories').length, 1)
  assert.equal(page.data.list.length, 0)
  assert.equal(state.toasts.at(-1).title, '已清空')
})

test('清空全部：列表为空时不弹确认框', async () => {
  const { page, state } = createMemoryPage({ api: { fetchAiMemories: () => Promise.resolve({ records: [] }) } })
  page.onShow()
  await flush()

  page.onClearAll()
  await flush()

  assert.equal(state.modals.length, 0)
  assert.equal(calls(state, 'deleteAllAiMemories').length, 0)
})

test('加载失败：给出错误态，重试成功后清掉错误', async () => {
  let attempt = 0
  const { page } = createMemoryPage({
    api: {
      fetchAiMemories: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(new Error('网络异常'))
        return Promise.resolve({ records: [{ memoryKey: 'habit', memoryText: '晚饭后散步', confidence: 90, updatedAt: '2026-11-17T20:00:00' }] })
      }
    }
  })
  page.onShow()
  await flush()

  assert.equal(page.data.error, '网络异常')
  assert.equal(page.data.list.length, 0)

  page.onRetry()
  await flush()

  assert.equal(page.data.error, '')
  assert.equal(page.data.list.length, 1)
  assert.equal(page.data.list[0].label, '生活习惯')
})

test('下拉刷新：重新拉取并收起刷新动画', async () => {
  const { page, state } = createMemoryPage()
  page.onPullDownRefresh()
  await flush()

  assert.equal(calls(state, 'fetchAiMemories').length, 1)
  assert.equal(state.pullDownStops, 1)
})
