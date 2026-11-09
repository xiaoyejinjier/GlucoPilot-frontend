const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const chatSessions = require('../../utils/chat-sessions')

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
      if (item && item.success) item.success({ confirm: true, cancel: false })
    },
    showActionSheet: (item) => state.sheets.push(item),
    navigateTo: (item) => state.navs.push(item),
    navigateBack: (item) => state.navs.push(item),
    switchTab: (item) => state.navs.push(item),
    reLaunch: (item) => state.relaunches.push(item),
    setNavigationBarTitle: (item) => state.titles.push(item),
    stopPullDownRefresh: () => {
      state.pullDownStops += 1
    },
    nextTick: (fn) => fn(),
    getStorageSync: () => 'token',
    setStorageSync() {},
    removeStorageSync() {}
  }
}

/** 加载「历史对话」列表页；api 里只有列表/置顶/删除三个方法会被用到 */
function createHistoryPage(options = {}) {
  let definition
  const state = { calls: [], toasts: [], modals: [], sheets: [], navs: [], titles: [], pullDownStops: 0 }
  const api = {
    fetchChatSessions: () => Promise.resolve(chatSessions.normalizeSessionPage({ records: [], total: '0' })),
    setChatSessionPinned: () => Promise.resolve(null),
    deleteChatSession: () => Promise.resolve(null),
    ...options.api
  }
  const apiStub = {
    fetchChatSessions: (params) => {
      state.calls.push({ name: 'fetchChatSessions', args: [params] })
      return api.fetchChatSessions(params)
    },
    setChatSessionPinned: (id, pinned) => {
      state.calls.push({ name: 'setChatSessionPinned', args: [id, pinned] })
      return api.setChatSessionPinned(id, pinned)
    },
    deleteChatSession: (id) => {
      state.calls.push({ name: 'deleteChatSession', args: [id] })
      return api.deleteChatSession(id)
    }
  }
  const dependencies = {
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/chat-sessions': chatSessions,
    '../../services/api': apiStub
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/chat-history/chat-history.js'), 'utf8'), {
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

/** 加载对话页（只用到会话恢复相关的那一路依赖） */
function createChatPage(options = {}) {
  let definition
  const state = {
    app: { globalData: { isLoggedIn: true, pendingChatSession: null, pendingNewChat: false, chatSessionEvent: null } },
    calls: [],
    toasts: [],
    modals: [],
    navs: [],
    titles: [],
    relaunches: []
  }
  const api = {
    getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 1 }),
    createChatSession: () => {
      throw new Error('不能强制新建对话')
    },
    ...options.api
  }
  const apiStub = {
    getOrCreateChatSession: (type) => {
      state.calls.push({ name: 'getOrCreateChatSession', args: [type] })
      return api.getOrCreateChatSession(type)
    },
    createChatSession: (type) => {
      state.calls.push({ name: 'createChatSession', args: [type] })
      return api.createChatSession(type)
    },
    fetchChatHistory: (id, params) => {
      state.calls.push({ name: 'fetchChatHistory', args: [id, params] })
      return api.fetchChatHistory
        ? api.fetchChatHistory(id, params)
        : Promise.resolve({ messages: [], hasMore: false, nextBeforeSeq: null })
    },
    sendChatMessage: () => Promise.resolve({ id: '101' }),
    streamChatCompletion: () => ({ abort() {} })
  }
  const dependencies = {
    '../../utils/locales/en': require('../../utils/locales/en'),
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/chat-sessions': chatSessions,
    '../../utils/request': { getToken: () => 'token' },
    '../../services/api': apiStub,
    '../../utils/media': { uploadChatImage: () => Promise.resolve({ id: '9' }) }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/voice.js'), 'utf8'), {
    Page(value) {
      definition = value
    },
    wx: makeWx(state),
    getApp: () => state.app,
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
    },
    getTabBar: () => ({ setData() {} })
  }
  return { page, state }
}

const ROWS = [
  { id: '49', title: '控糖饮食怎么记', sessionStatus: 2, sessionType: 3, msgCount: 4, lastMsgAt: '2026-10-14T21:05:00' },
  { id: '48', title: '早餐前血糖 6.8 正常吗', sessionStatus: 1, sessionType: 3, msgCount: 6, isPinned: true, lastMsgAt: '2026-10-15T09:12:33' }
]

// ---------------------------------------------------------------- 1. 列表页

test('历史对话列表：首屏只取第一页、置顶排前、hasMore 按总数判断', async () => {
  const { page, state } = createHistoryPage({
    api: {
      fetchChatSessions: () => Promise.resolve(chatSessions.normalizeSessionPage({ records: ROWS, total: '2' }))
    }
  })
  page.onShow()
  await flush()

  assert.equal(state.calls[0].name, 'fetchChatSessions')
  assert.equal(state.calls[0].args[0].pageNum, 1)
  assert.equal(state.calls[0].args[0].pageSize, 20)
  // 「全部」页签不传 sessionStatus，后端才不会按状态过滤
  assert.equal(state.calls[0].args[0].sessionStatus, undefined)

  assert.equal(json(page.data.list.map((item) => item.id)), '["48","49"]')
  assert.equal(page.data.list[0].isPinned, true)
  assert.equal(page.data.hasMore, false)
  assert.equal(page.data.pageNum, 2)
  assert.equal(page.data.loading, false)
})

test('历史对话列表：切换筛选带上 sessionStatus 并重取第一页', async () => {
  const { page, state } = createHistoryPage({
    api: {
      fetchChatSessions: (params) => Promise.resolve(chatSessions.normalizeSessionPage({
        records: params.sessionStatus === 2 ? [ROWS[0]] : ROWS,
        total: params.sessionStatus === 2 ? '1' : '2'
      }))
    }
  })
  page.onShow()
  await flush()

  page.onFilterTap({ currentTarget: { dataset: { key: 2 } } })
  await flush()

  assert.equal(page.data.filterKey, 2)
  assert.equal(state.calls[state.calls.length - 1].args[0].sessionStatus, 2)
  assert.equal(state.calls[state.calls.length - 1].args[0].pageNum, 1)
  assert.equal(json(page.data.list.map((item) => item.id)), '["49"]')

  // 同值重复点击不发请求
  const before = state.calls.length
  page.onFilterTap({ currentTarget: { dataset: { key: 2 } } })
  await flush()
  assert.equal(state.calls.length, before)
})

test('历史对话列表：点行带上 from=history 打开对话页', async () => {
  const { page, state } = createHistoryPage({
    api: { fetchChatSessions: () => Promise.resolve(chatSessions.normalizeSessionPage({ records: ROWS, total: '2' })) }
  })
  page.onShow()
  await flush()

  page.onSessionTap({ currentTarget: { dataset: { id: '49' } } })

  assert.equal(state.navs.length, 1)
  const url = state.navs[0].url
  assert.ok(url.startsWith('/pages/voice/voice?'), url)
  assert.ok(url.includes('from=history'), url)
  assert.ok(url.includes('sessionId=49'), url)
  assert.ok(url.includes('sessionStatus=2'), url)
  assert.ok(url.includes('title=' + encodeURIComponent('控糖饮食怎么记')), url)
})

test('历史对话列表：长按置顶与删除，成功后刷新并提示', async () => {
  let records = ROWS.map((item) => ({ ...item }))
  const { page, state } = createHistoryPage({
    api: {
      fetchChatSessions: () => Promise.resolve(chatSessions.normalizeSessionPage({ records, total: String(records.length) })),
      setChatSessionPinned: () => Promise.resolve(null),
      deleteChatSession: (id) => {
        records = records.filter((item) => item.id !== id)
        return Promise.resolve(null)
      }
    }
  })
  page.onShow()
  await flush()

  // 长按未置顶的那条：菜单文案是「置顶 / 删除对话」
  page.onSessionLongPress({ currentTarget: { dataset: { id: '49' } } })
  assert.equal(json(state.sheets[0].itemList), json(['置顶', '删除对话']))

  state.sheets[0].success({ tapIndex: 0 })
  await flush()
  assert.equal(json(state.calls.filter((c) => c.name === 'setChatSessionPinned')[0].args), json(['49', true]))
  assert.equal(page.data.list.find((item) => item.id === '49').isPinned, true)
  assert.equal(state.toasts[state.toasts.length - 1].title, '已置顶')

  // 长按已置顶的那条：文案变成「取消置顶」
  page.onSessionLongPress({ currentTarget: { dataset: { id: '48' } } })
  assert.equal(state.sheets[state.sheets.length - 1].itemList[0], '取消置顶')

  // 删除：确认后调接口并重新拉第一页
  page.onSessionLongPress({ currentTarget: { dataset: { id: '49' } } })
  const sheet = state.sheets[state.sheets.length - 1]
  const callsBefore = state.calls.length
  sheet.success({ tapIndex: 1 })
  await flush()

  assert.equal(state.modals[state.modals.length - 1].title, '删除对话')
  assert.equal(state.calls.filter((c) => c.name === 'deleteChatSession')[0].args[0], '49')
  assert.equal(page.data.list.some((item) => item.id === '49'), false)
  assert.equal(state.toasts[state.toasts.length - 1].title, '对话已删除')
  assert.ok(state.calls.length > callsBefore)
})

test('历史对话列表：首屏失败给重试入口，重试成功后清错误', async () => {
  let fail = true
  const { page } = createHistoryPage({
    api: {
      fetchChatSessions: () => (fail
        ? Promise.reject(new Error('网络开小差了'))
        : Promise.resolve(chatSessions.normalizeSessionPage({ records: ROWS, total: '2' })))
    }
  })
  page.onShow()
  await flush()
  assert.equal(page.data.error, '网络开小差了')
  assert.equal(page.data.list.length, 0)

  fail = false
  page.onRetry()
  await flush()
  assert.equal(page.data.error, '')
  assert.equal(page.data.list.length, 2)
})

// ---------------------------------------------------------------- 2. 对话页打开历史会话

test('从历史列表进入：直接用带过来的 sessionId 读历史，不再取当前会话', async () => {
  const { page, state } = createChatPage()
  page.onLoad({ from: 'history', sessionId: '99', sessionStatus: '2', title: '控糖饮食怎么记' })

  assert.equal(page.data.sessionId, '99')
  assert.equal(page.data.fromHistory, true)
  assert.equal(page.data.sessionTitle, '控糖饮食怎么记')
  assert.equal(page.data.sessionReadOnly, true)
  assert.equal(state.titles[state.titles.length - 1].title, '控糖饮食怎么记')

  page.onShow()
  await flush()

  assert.equal(json(state.calls.map((call) => call.name)), '["fetchChatHistory"]')
  assert.equal(state.calls[0].args[0], '99')
  assert.equal(page.data.historyReady, true)
})

test('只有 from=history 才认 sessionId，普通进入仍自动恢复当前会话', async () => {
  const { page, state } = createChatPage()
  page.onLoad({ sessionId: '99', sessionStatus: '2' })
  page.onShow()
  await flush()

  assert.equal(page.data.fromHistory, false)
  assert.equal(page.data.sessionId, '48')
  assert.equal(state.calls[0].name, 'getOrCreateChatSession')
})

test('历史只读会话里点「回到当前对话」：清掉预设会话并重新取当前会话', async () => {
  const { page, state } = createChatPage()
  page.onLoad({ from: 'history', sessionId: '99', sessionStatus: '0', title: '旧对话' })
  page.onShow()
  await flush()
  assert.equal(page.data.sessionReadOnly, true)
  assert.equal(page.data.fromHistory, true)

  await page.onBackToCurrent()

  assert.equal(page.data.sessionId, '48')
  assert.equal(page.data.fromHistory, false)
  assert.equal(page.data.sessionReadOnly, false)
  assert.equal(state.titles[state.titles.length - 1].title, '小语')
  const names = state.calls.map((call) => call.name)
  assert.ok(names.includes('getOrCreateChatSession'), names.join(','))
  assert.equal(state.calls.filter((call) => call.name === 'fetchChatHistory').pop().args[0], '48')
})
