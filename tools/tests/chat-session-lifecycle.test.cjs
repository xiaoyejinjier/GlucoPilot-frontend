const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const chatSessions = require('../../utils/chat-sessions')

/** 在独立的 vm 上下文里加载模块，并注入受控的 require（与仓库既有测试同一套做法）。 */
function loadModule(relativePath, requireStub) {
  const sandbox = {
    module: { exports: {} },
    require: requireStub || ((name) => { throw new Error(`未预料的依赖：${name}`) }),
    setTimeout,
    clearTimeout,
    console
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox)
  return sandbox.module.exports
}

/** 跨 vm 上下文的对象原型不同，deepEqual 会误判，统一比 JSON 文本。 */
function json(value) {
  return JSON.stringify(value)
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

// ------------------------------------------------------------------ 1. 列表记录归一化

test('会话列表归一化：id/total 是字符串、缺字段兜底、状态文案与可发送判断', () => {
  const now = new Date('2026-10-15T10:00:00')
  const page = chatSessions.normalizeSessionPage({
    records: [
      {
        id: '48',
        title: '早餐前血糖 6.8 正常吗',
        sessionStatus: 1,
        sessionType: 3,
        msgCount: 6,
        isPinned: true,
        lastMsgAt: '2026-10-15T09:12:33',
        createdAt: '2026-10-15T09:00:00',
        lastMessagePreview: '在正常范围内……'
      },
      // 数字 id（后端若改用数字序列化也要能扛住）、空白标题、已结束
      { id: 49, title: '   ', sessionStatus: 2, msgCount: '4', lastMsgAt: '2026-10-14T21:05:00' },
      // 全缺：不能抛错，也不能渲染出 undefined
      {}
    ],
    total: '3',
    archiveIdleDays: 30
  }, now)

  assert.equal(typeof page.total, 'string')
  assert.equal(page.total, '3')
  assert.equal(page.archiveIdleDays, 30)
  assert.equal(page.records.length, 3)

  const [today, ended, blank] = page.records
  assert.equal(today.id, '48')
  assert.equal(typeof today.id, 'string')
  assert.equal(today.title, '早餐前血糖 6.8 正常吗')
  assert.equal(today.sessionStatus, 1)
  assert.equal(today.sessionStatusText, '进行中')
  assert.equal(today.canSend, true)
  assert.equal(today.readOnly, false)
  assert.equal(today.msgCount, 6)
  assert.equal(today.isPinned, true)
  assert.equal(today.lastMessagePreview, '在正常范围内……')
  // 今天 → HH:mm
  assert.equal(today.timeText, '09:12')

  assert.equal(ended.id, '49')
  assert.equal(ended.title, '新对话')
  assert.equal(ended.sessionStatusText, '已结束')
  assert.equal(ended.canSend, false)
  assert.equal(ended.readOnly, true)
  assert.equal(ended.msgCount, 4)
  // 同年更早 → MM-DD
  assert.equal(ended.timeText, '10-14')

  assert.equal(blank.id, '')
  assert.equal(blank.title, '新对话')
  assert.equal(blank.sessionStatus, null)
  assert.equal(blank.sessionStatusText, '')
  assert.equal(blank.msgCount, 0)
  assert.equal(blank.isPinned, false)
  assert.equal(blank.timeText, '')
  // 状态缺失时不锁界面：交给后端 requireActive 兜底拒绝，避免接口微调把用户锁死在只读页
  assert.equal(blank.canSend, true)

  // 归档（0）同样是只读，文案与已结束区分开
  const archived = chatSessions.normalizeSessionRow({ id: '7', sessionStatus: 0 }, now)
  assert.equal(archived.sessionStatusText, '已归档')
  assert.equal(archived.readOnly, true)
  assert.equal(chatSessions.sessionGate(0).notice, chatSessions.ARCHIVED_NOTICE)
  assert.equal(chatSessions.sessionGate(2).notice, chatSessions.ENDED_NOTICE)

  // 跨年 → YYYY-MM-DD
  assert.equal(chatSessions.formatSessionTime('2025-12-31T08:00:00', now), '2025-12-31')
  // 空列表 / 坏响应都要给可用结构
  assert.equal(json(chatSessions.normalizeSessionPage(null).records), '[]')
  assert.equal(chatSessions.normalizeSessionPage(null).total, '0')
})

// ------------------------------------------------------------------ 2. 历史消息正序与翻页参数

test('会话内历史：按 seqNo 正序渲染、角色与图片映射、翻页参数用 nextBeforeSeq', () => {
  const page = chatSessions.normalizeHistoryPage({
    // 故意给倒序：后端已反转成正序，但换实现/换版本时不能让界面跟着反
    records: [
      { id: '103', seqNo: 3, msgRole: 2, msgType: 1, contentText: '建议再测一次', createdAt: '2026-10-15T09:03:00' },
      { id: '101', seqNo: 1, msgRole: 1, msgType: 1, contentText: '早餐前 6.8 正常吗', createdAt: '2026-10-15T09:00:01' },
      { id: '102', seqNo: 2, msgRole: 1, msgType: 2, contentText: null, mediaId: '9',
        mediaUrl: 'http://example.invalid/x.png', createdAt: '2026-10-15T09:02:00' },
      // 系统消息不进对话视图
      { id: '100', seqNo: 0, msgRole: 3, msgType: 1, contentText: 'system prompt' }
    ],
    hasMore: true,
    nextBeforeSeq: 1
  })

  assert.equal(json(page.messages.map((m) => m.seqNo)), '[1,2,3]')
  assert.equal(json(page.messages.map((m) => m.role)), '["user","user","ai"]')
  assert.equal(page.messages[0].content, '早餐前 6.8 正常吗')
  assert.equal(page.messages[0].id, 'h101')
  assert.equal(page.messages[1].type, 'image')
  assert.equal(page.messages[1].fileUrl, 'http://example.invalid/x.png')
  assert.equal(page.messages[2].type, 'text')
  assert.equal(page.hasMore, true)
  assert.equal(page.nextBeforeSeq, 1)

  // 图片已被清理（mediaUrl 为空）时留空，模板显示"图片已失效"，不能塞假路径
  const broken = chatSessions.normalizeHistoryPage({
    records: [{ id: '1', seqNo: 1, msgRole: 1, msgType: 2, mediaUrl: null }]
  })
  assert.equal(broken.messages[0].type, 'image')
  assert.equal(broken.messages[0].fileUrl, '')
  assert.equal(json(chatSessions.normalizeHistoryPage(null).messages), '[]')

  // 第一页不传 beforeSeq；后续传上一页的 nextBeforeSeq
  assert.equal(json(chatSessions.buildHistoryQuery()), '{"pageSize":20}')
  assert.equal(json(chatSessions.buildHistoryQuery({ pageSize: 20, beforeSeq: 1 })), '{"pageSize":20,"beforeSeq":1}')
  // beforeSeq 必须是正整数，0/空值等同"第一页"
  assert.equal(json(chatSessions.buildHistoryQuery({ beforeSeq: 0 })), '{"pageSize":20}')
  assert.equal(json(chatSessions.buildHistoryQuery({ beforeSeq: null })), '{"pageSize":20}')
  // 更早的一页拼在前面，整段对话仍是正序
  const older = [{ seqNo: 5 }, { seqNo: 6 }]
  const current = [{ seqNo: 7 }]
  assert.equal(json(chatSessions.mergeHistory(older, current).map((m) => m.seqNo)), '[5,6,7]')

  // 列表查询：sessionStatus 为空表示"全部"，此时不能传该字段
  assert.equal(json(chatSessions.buildSessionListQuery({ pageNum: 2, pageSize: 20 })), '{"pageNum":2,"pageSize":20}')
  assert.equal(json(chatSessions.buildSessionListQuery({ sessionStatus: 0 })), '{"pageNum":1,"pageSize":20,"sessionStatus":0}')
})

// ------------------------------------------------------------------ 3. api 层：路径 / 方法 / 入参

function createApi(responder) {
  const calls = []
  const request = {
    getToken: () => 'token',
    setToken() {},
    get(url, data, options) { calls.push({ method: 'GET', url, data, options }); return responder({ method: 'GET', url, data }) },
    post(url, data, options) { calls.push({ method: 'POST', url, data, options }); return responder({ method: 'POST', url, data }) },
    put(url, data, options) { calls.push({ method: 'PUT', url, data, options }); return responder({ method: 'PUT', url, data }) },
    patch(url, data, options) { calls.push({ method: 'PATCH', url, data, options }); return responder({ method: 'PATCH', url, data }) },
    del(url, data, options) { calls.push({ method: 'DELETE', url, data, options }); return responder({ method: 'DELETE', url, data }) }
  }
  const api = loadModule('services/api.js', (name) => {
    if (name === './meal-analysis-mock') return { isEnabled: () => false, analyzeMealPhoto: () => Promise.resolve({}) }
    if (name === '../utils/request') return request
    if (name === '../utils/mappers') return {}
    if (name === '../utils/food-images') return { getFoodImage: () => '' }
    if (name === '../utils/sse') return { openSse: () => ({ abort() {} }) }
    assert.equal(name, '../utils/chat-sessions')
    return chatSessions
  })
  return { api, calls, request }
}

test('"新对话"调用体必须是 forceNew:true；列表/历史/删除/置顶走对路径与方法', async () => {
  const { api, calls } = createApi((call) => {
    if (call.url === '/chat-sessions/current') return Promise.resolve({ code: 0, data: { id: '77', sessionStatus: 1, title: '新对话', sessionType: 3, msgCount: 0 } })
    if (call.url === '/chat-sessions') {
      return Promise.resolve({
        records: [{ id: '48', title: '早餐前血糖', sessionStatus: 2, msgCount: 6, isPinned: false, lastMsgAt: '2026-10-15T09:12:33' }],
        total: '3',
        archiveIdleDays: 30
      })
    }
    if (call.url === '/chat-sessions/48/messages') {
      return Promise.resolve({ records: [{ id: '101', seqNo: 1, msgRole: 1, msgType: 1, contentText: '你好' }], hasMore: true, nextBeforeSeq: 1 })
    }
    return Promise.resolve(null)
  })

  // 新建：不传 forceNew 是"取或建"，所以"新对话"必须显式带上，否则永远开不出新会话
  await api.createChatSession(3)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, '/chat-sessions/current')
  assert.equal(json(calls[0].data), '{"sessionType":3,"forceNew":true}')
  assert.equal(calls[0].options.auth, true)

  await api.getOrCreateChatSession(3)
  assert.equal(json(calls[1].data), '{"sessionType":3}')

  // 列表：分页参数 + 归一化（id/total 仍是字符串）
  const page = await api.fetchChatSessions({ pageNum: 2, pageSize: 20 })
  assert.equal(calls[2].method, 'GET')
  assert.equal(calls[2].url, '/chat-sessions')
  assert.equal(json(calls[2].data), '{"pageNum":2,"pageSize":20}')
  assert.equal(page.records[0].id, '48')
  assert.equal(typeof page.records[0].id, 'string')
  assert.equal(page.total, '3')
  assert.equal(page.records[0].sessionStatusText, '已结束')

  // 历史：sessionId 按字符串进路径（Long 精度问题），beforeSeq 传上一页的 nextBeforeSeq
  const history = await api.fetchChatHistory('48', { pageSize: 20, beforeSeq: 7 })
  assert.equal(calls[3].method, 'GET')
  assert.equal(calls[3].url, '/chat-sessions/48/messages')
  assert.equal(json(calls[3].data), '{"pageSize":20,"beforeSeq":7}')
  assert.equal(history.messages[0].content, '你好')
  assert.equal(history.hasMore, true)

  await api.fetchChatHistory('48')
  assert.equal(json(calls[4].data), '{"pageSize":20}')

  // 删除（后端幂等，重复删也返回成功，端上不需要做"已删过"的特殊分支）
  await api.deleteChatSession('48')
  assert.equal(calls[5].method, 'DELETE')
  assert.equal(calls[5].url, '/chat-sessions/48')
  assert.equal(calls[5].data, null)

  await api.setChatSessionPinned('48', true)
  assert.equal(calls[6].method, 'PATCH')
  assert.equal(calls[6].url, '/chat-sessions/48/pinned')
  assert.equal(json(calls[6].data), '{"isPinned":true}')
  await api.setChatSessionPinned('48', false)
  assert.equal(json(calls[7].data), '{"isPinned":false}')
})

// ------------------------------------------------------------------ 4. 对话页

function createChatPage(options = {}) {
  let definition
  const state = {
    app: {
      globalData: {
        isLoggedIn: options.loggedIn !== false,
        pendingChatSession: null,
        pendingNewChat: false,
        chatSessionEvent: null
      }
    },
    calls: [],
    toasts: [],
    modals: [],
    sheets: [],
    navs: [],
    relaunches: [],
    chooseMedia: 0
  }
  const api = options.api || {}
  const apiStub = {
    getOrCreateChatSession: (type) => { state.calls.push({ name: 'getOrCreateChatSession', args: [type] }); return api.getOrCreateChatSession(type) },
    createChatSession: (type) => { state.calls.push({ name: 'createChatSession', args: [type] }); return api.createChatSession(type) },
    fetchChatHistory: (id, params) => { state.calls.push({ name: 'fetchChatHistory', args: [id, params] }); return api.fetchChatHistory ? api.fetchChatHistory(id, params) : Promise.resolve({ messages: [], hasMore: false, nextBeforeSeq: null }) },
    sendChatMessage: (id, payload) => { state.calls.push({ name: 'sendChatMessage', args: [id, payload] }); return api.sendChatMessage(id, payload) },
    streamChatCompletion: (id, payload, handlers) => { state.calls.push({ name: 'streamChatCompletion', args: [id, payload] }); return { abort() {} } }
  }
  const dependencies = {
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../utils/chat-sessions': chatSessions,
    '../../utils/request': { getToken: () => 'token' },
    '../../services/api': apiStub,
    '../../utils/media': { uploadChatImage: options.uploadChatImage || (() => Promise.resolve({ id: '9', fileUrl: 'http://example.invalid/x.png' })) }
  }
  const wx = {
    showToast: (item) => state.toasts.push(item),
    showModal: (item) => { state.modals.push(item); if (item.success) item.success({ confirm: true }) },
    showActionSheet: (item) => state.sheets.push(item),
    navigateTo: (item) => state.navs.push(item),
    switchTab: (item) => state.navs.push(item),
    navigateBack: (item) => state.navs.push(item),
    reLaunch: (item) => state.relaunches.push(item),
    chooseMedia: (item) => { state.chooseMedia += 1; if (item && item.success) item.success({ tempFiles: [] }) },
    previewImage() {},
    stopPullDownRefresh() {},
    nextTick: (fn) => fn(),
    getStorageSync: () => 'token',
    setStorageSync() {},
    removeStorageSync() {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/voice.js'), 'utf8'), {
    Page(value) { definition = value },
    wx,
    getApp: () => state.app,
    require: (name) => { assert.ok(dependencies[name], name); return dependencies[name] },
    setTimeout,
    clearTimeout,
    console
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() },
    getTabBar: () => ({ setData() {} })
  }
  return { page, state, api }
}

test('切换会话后旧发送回调不能启动旧会话的模型回复', async () => {
  let complete
  const saved = new Promise(resolve => { complete = resolve })
  const { page, state } = createChatPage({ api: { sendChatMessage: () => saved } })
  page.onLoad({ sessionId: '48', sessionStatus: '1' }); page.onShow(); await flush()
  page.onInput({ detail: { value: '旧会话问题' } }); page.onSend(); await flush()
  await page.openSession({ id: '77', sessionStatus: 1 })
  complete({ id: '101' }); await flush()
  assert.equal(page.data.sessionId, '77')
  assert.equal(page.data.sending, false)
  assert.equal(state.calls.filter(call => call.name === 'streamChatCompletion').length, 0)
})

test('切换会话后旧图片上传结果不能写入新会话', async () => {
  let complete
  const uploaded = new Promise(resolve => { complete = resolve })
  const { page, state } = createChatPage({ uploadChatImage: () => uploaded })
  page.onLoad({ sessionId: '48', sessionStatus: '1' }); page.onShow(); await flush()
  page.sendImage('/temporary-old-image.jpg')
  await page.openSession({ id: '77', sessionStatus: 1 })
  complete({ id: '9', fileUrl: 'https://example.invalid/old.jpg' }); await flush()
  assert.equal(page.data.sessionId, '77')
  assert.equal(page.data.messages.length, 0)
  assert.equal(state.calls.filter(call => call.name === 'sendChatMessage').length, 0)
})

test('带 sessionId 打开已结束会话：走历史接口、正序渲染、输入区禁用且不发消息', async () => {
  const called = []
  const { page, state } = createChatPage({
    api: {
      fetchChatHistory: (id, params) => {
        called.push(params)
        assert.equal(id, '48')
        return Promise.resolve({
          messages: [
            { id: 'h101', role: 'user', type: 'text', content: '早餐前 6.8 正常吗', seqNo: 1 },
            { id: 'h102', role: 'ai', type: 'text', content: '在正常范围内', seqNo: 2 }
          ],
          hasMore: false,
          nextBeforeSeq: 1
        })
      },
      getOrCreateChatSession: () => { throw new Error('已指定 sessionId 时不应再走 /current'); },
      sendChatMessage: () => { throw new Error('已结束会话不能发消息'); }
    }
  })

  page.onLoad({ sessionId: '48', sessionStatus: '2' })
  page.onShow()
  await flush()

  assert.equal(json(called), '[{"pageSize":20}]')
  assert.equal(json(page.data.messages.map((m) => m.id)), '["h101","h102"]')
  assert.equal(page.data.sessionId, '48')
  assert.equal(page.data.historyLoading, false)
  assert.equal(page.data.sessionReadOnly, true)
  assert.equal(page.data.sessionStatusText, '已结束')
  assert.ok(page.data.sessionNotice.includes('已结束') && page.data.sessionNotice.includes('新对话'))

  // 先输入再点发送：必须一条消息都不发（后端也会拒绝，但没必要让用户先看到失败气泡）
  page.onInput({ detail: { value: '那餐后呢' } })
  page.onSend()
  page.onChooseImage()
  await flush()
  assert.equal(state.calls.filter((c) => c.name === 'sendChatMessage').length, 0)
  assert.equal(state.chooseMedia, 0)
  assert.equal(state.toasts.length, 2)
  assert.ok(state.toasts[0].title.includes('已结束'))

  // 兜底：就算有别的路径直接进 startRound，也不能真的发出去
  page.sendText('绕过入口')
  await flush()
  assert.equal(state.calls.filter((c) => c.name === 'sendChatMessage').length, 0)
  assert.equal(page.data.messages[page.data.messages.length - 1].error, true)
})

test('翻页：查看更早的对话用 nextBeforeSeq 当 beforeSeq，更早的一页拼在消息列表前面', async () => {
  const pages = [
    { messages: [{ id: 'h102', role: 'user', type: 'text', content: '第二页', seqNo: 2 },
      { id: 'h103', role: 'ai', type: 'text', content: '第三页', seqNo: 3 }], hasMore: true, nextBeforeSeq: 2 },
    { messages: [{ id: 'h101', role: 'user', type: 'text', content: '第一页', seqNo: 1 }], hasMore: false, nextBeforeSeq: 1 }
  ]
  const seen = []
  const { page, state } = createChatPage({
    api: {
      fetchChatHistory: (id, params) => { seen.push(params); return Promise.resolve(pages[seen.length - 1]) },
      sendChatMessage: () => Promise.resolve({ id: '9' })
    }
  })

  page.onLoad({ sessionId: '48', sessionStatus: '1' })
  page.onShow()
  await flush()
  assert.equal(page.data.sessionReadOnly, false)
  assert.equal(page.data.historyHasMore, true)

  page.onLoadEarlier()
  await flush()
  assert.equal(json(seen), '[{"pageSize":20},{"pageSize":20,"beforeSeq":2}]')
  assert.equal(json(page.data.messages.map((m) => m.seqNo)), '[1,2,3,null]')
  assert.equal(page.data.historyHasMore, false)

  // 没有更早的了：不再发请求，只提示
  page.onLoadEarlier()
  await flush()
  assert.equal(seen.length, 2)
  assert.equal(state.toasts[state.toasts.length - 1].title, '已经是全部记录了')
})

test('新对话：调用 forceNew 接口、采用返回的新会话并清空视图', async () => {
  const created = []
  const { page, state } = createChatPage({
    api: {
      getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 1, title: '旧会话' }),
      createChatSession: (type) => { created.push(type); return Promise.resolve({ id: '77', sessionStatus: 1, title: '新对话' }) }
    }
  })

  page.onLoad({})
  page.onShow()
  await flush()
  assert.equal(page.data.sessionId, '48')
  assert.equal(page.data.sessionReadOnly, false)
  // 不带参数进入时行为不变：仍然是"取或建当前会话"
  assert.equal(json(state.calls.map((c) => c.name)), '["getOrCreateChatSession","fetchChatHistory"]')

  await page.onNewChat()
  assert.equal(json(created), '[3]')
  assert.equal(page.data.sessionId, '77')
  assert.equal(page.data.sessionTitle, '新对话')
  assert.equal(page.data.sessionReadOnly, false)
  assert.equal(page.data.sessionNotice, '')
  assert.equal(page.data.messages.length, 0)
  assert.equal(page.data.historyReady, true)
  assert.equal(state.toasts[state.toasts.length - 1].title, '已开启新对话')
})

test('状态未知时会先放行，被后端以 40001 拒绝后自动切成只读并给出提示', async () => {
  const { page } = createChatPage({
    api: {
      fetchChatHistory: () => Promise.resolve({ messages: [], hasMore: false, nextBeforeSeq: null }),
      sendChatMessage: () => Promise.reject(Object.assign(
        new Error('该会话已结束，不能继续发送消息：请新建对话'), { code: 40001 }))
    }
  })

  // 没有 sessionStatus（例如只带 sessionId 直接进页面）：不预先禁用
  page.onLoad({ sessionId: '48' })
  page.onShow()
  await flush()
  assert.equal(page.data.sessionReadOnly, false)

  page.onInput({ detail: { value: '还能聊吗' } })
  page.onSend()
  await flush()
  await flush()
  assert.equal(page.data.sessionReadOnly, true)
  assert.ok(page.data.sessionNotice.includes('已结束'))
  assert.equal(page.data.messages[page.data.messages.length - 1].error, true)

  // 只读后再点重试也不发消息
  page.onRetry({ currentTarget: { dataset: { id: page.data.messages[page.data.messages.length - 1].id } } })
  await flush()
  assert.equal(page.data.sessionReadOnly, true)
})

test('对话页保留了 SSE 链路与图片消息渲染，当前会话被删掉后回到初始状态', async () => {
  const { page, state } = createChatPage({
    api: {
      getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 1, title: '旧会话' }),
      sendChatMessage: () => Promise.resolve({ id: '101' }),
      streamChatCompletion: () => ({ abort() {} })
    }
  })
  page.onLoad({})
  page.onShow()
  await flush()
  assert.equal(page.data.sessionId, '48')

  // 历史列表页删掉的正是当前会话：回本页时应清空视图，而不是继续对着一条已删会话发消息
  state.app.globalData.chatSessionEvent = { type: 'deleted', id: '48' }
  page.onShow()
  assert.equal(page.data.sessionId, '')
  assert.equal(page.data.messages.length, 0)
  // 随后按"取或建当前会话"重新拿一条（后端删掉进行中会话后 /current 会新建）
  await flush()
  assert.equal(page.data.sessionId, '48')

  // 发消息链路未改动：写库成功后会开流
  page.onInput({ detail: { value: '你好' } })
  page.onSend()
  await flush()
  assert.equal(state.calls.filter((c) => c.name === 'sendChatMessage').length, 1)
  assert.equal(state.calls.filter((c) => c.name === 'streamChatCompletion').length, 1)
  const payload = state.calls.find((c) => c.name === 'sendChatMessage').args[1]
  assert.equal(payload.msgType, 1)
  assert.equal(payload.contentText, '你好')
  assert.ok(payload.clientMsgId)
})

test('打开一条已被删除的会话（404）时回到初始状态，不再停在空会话上', async () => {
  const { page, state } = createChatPage({
    api: {
      fetchChatHistory: () => Promise.reject(Object.assign(
        new Error('会话不存在或不属于当前用户'), { code: 40400, statusCode: 404 })),
      getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 1, title: '当前会话' })
    }
  })

  page.onLoad({ sessionId: '48', sessionStatus: '1' })
  page.onShow()
  await flush()
  assert.equal(page.data.sessionId, '')
  assert.equal(page.data.historyLoading, false)
  assert.equal(page.data.sessionReadOnly, false)
  assert.equal(page.data.messages.length, 0)
  assert.equal(state.toasts[state.toasts.length - 1].title, '该对话已被删除')
})

// ------------------------------------------------------------------ 5. 历史会话列表页

function createHistoryPage(options = {}) {
  let definition
  const state = {
    app: { globalData: { pendingChatSession: null, pendingNewChat: false, chatSessionEvent: null } },
    calls: [],
    toasts: [],
    modals: [],
    sheets: [],
    navs: [],
    confirmResult: true
  }
  const api = options.api
  const apiStub = {
    fetchChatSessions: (params) => { state.calls.push({ name: 'fetchChatSessions', args: [params] }); return api.fetchChatSessions(params) },
    deleteChatSession: (id) => { state.calls.push({ name: 'deleteChatSession', args: [id] }); return api.deleteChatSession(id) },
    setChatSessionPinned: (id, pinned) => { state.calls.push({ name: 'setChatSessionPinned', args: [id, pinned] }); return api.setChatSessionPinned(id, pinned) }
  }
  const wx = {
    showToast: (item) => state.toasts.push(item),
    // 二次确认的默认答案是"确认"，需要验证取消时把 state.confirmResult 置 false
    showModal: (item) => {
      state.modals.push(item)
      if (item.success) item.success({ confirm: state.confirmResult })
    },
    showActionSheet: (item) => { state.sheets.push(item); if (options.tapIndex != null) item.success({ tapIndex: options.tapIndex }) },
    navigateTo: (item) => state.navs.push(item),
    switchTab: (item) => state.navs.push(item),
    stopPullDownRefresh() {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/history.js'), 'utf8'), {
    Page(value) { definition = value },
    wx,
    getApp: () => state.app,
    require: (name) => {
      if (name === '../../utils/display') return { applyDisplayToCurrentPage() {} }
      if (name === '../../utils/chat-sessions') return chatSessions
      assert.equal(name, '../../services/api')
      return apiStub
    },
    setTimeout,
    clearTimeout,
    console
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value) }
  }
  return { page, state }
}

function sessionRow(id, extra = {}) {
  return {
    id: String(id),
    title: `会话 ${id}`,
    sessionStatus: 1,
    sessionType: 3,
    msgCount: 2,
    isPinned: false,
    lastMsgAt: '2026-10-15T09:12:33',
    createdAt: '2026-10-15T09:00:00',
    lastMessagePreview: '预览内容',
    ...extra
  }
}

test('历史列表页：分页上拉、置顶排前、点击带 sessionId 回对话页、删除二次确认', async () => {
  const pages = [
    { records: Array.from({ length: 20 }, (unused, i) => sessionRow(100 - i, { isPinned: i === 0 })),
      total: '23', archiveIdleDays: 30 },
    { records: [sessionRow(80), sessionRow(79), sessionRow(78)], total: '23', archiveIdleDays: 30 }
  ]
  const requests = []
  const { page, state } = createHistoryPage({
    api: {
      fetchChatSessions: (params) => { requests.push(params); return Promise.resolve(pages[requests.length - 1]) },
      deleteChatSession: () => Promise.resolve(null),
      setChatSessionPinned: () => Promise.resolve(null)
    }
  })

  await page.onShow()
  assert.equal(json(requests[0]), '{"pageNum":1,"pageSize":20}')
  assert.equal(page.data.list.length, 20)
  assert.equal(page.data.total, '23')
  assert.equal(typeof page.data.total, 'string')
  assert.equal(page.data.hasMore, true)
  assert.equal(page.data.archiveIdleDays, 30)
  // 置顶那条在最前（后端已置顶优先，端上再兜一次，防止本地重排后顺序错）
  assert.equal(page.data.list[0].isPinned, true)

  await page.onReachBottom()
  assert.equal(json(requests[1]), '{"pageNum":2,"pageSize":20}')
  assert.equal(page.data.list.length, 23)
  // 这一页没取满 → 没有下一页了，不去算字符串 total
  assert.equal(page.data.hasMore, false)

  // 点一条已结束会话：带 sessionId + 状态回对话页
  page.onTapSession({ currentTarget: { dataset: { id: '48', status: 2, title: '早餐前血糖 6.8 正常吗' } } })
  assert.equal(json(state.app.globalData.pendingChatSession), '{"id":"48","sessionStatus":2,"title":"早餐前血糖 6.8 正常吗"}')
  assert.equal(state.navs[state.navs.length - 1].url, '/pages/voice/voice')

  // 置顶：本地重排 + 调接口
  page.togglePinned('100', true)
  await flush()
  assert.equal(json(state.calls.filter((c) => c.name === 'setChatSessionPinned').map((c) => c.args)),
    '[["100",true]]')
  assert.equal(page.data.list[0].id, '100')
  assert.equal(page.data.list[0].isPinned, true)

  // 删除：必须二次确认，且文案写清"不可恢复"
  page.onLongPress({ currentTarget: { dataset: { id: '79', pinned: false } } })
  assert.equal(json(state.sheets[0].itemList), '["置顶","删除"]')
  const before = page.data.list.length
  page.confirmDelete('79')
  await flush()
  assert.ok(state.modals[0].content.includes('不可恢复'))
  assert.equal(state.modals[0].confirmText, '删除')
  assert.equal(json(state.calls.filter((c) => c.name === 'deleteChatSession').map((c) => c.args)), '[["79"]]')
  assert.equal(page.data.list.filter((item) => item.id === '79').length, 0)
  assert.equal(page.data.list.length, before - 1)
  // 通知对话页：被删的正好是它打开的那条
  assert.equal(json(state.app.globalData.chatSessionEvent), '{"type":"deleted","id":"79"}')

  // 取消确认时不删
  state.confirmResult = false
  page.confirmDelete('78')
  await flush()
  assert.equal(state.calls.filter((c) => c.name === 'deleteChatSession').length, 1)
})

test('历史列表页：取消置顶、操作表第二项删除、下拉刷新重拉第一页、空态引导', async () => {
  const requests = []
  const { page, state } = createHistoryPage({
    tapIndex: 1,
    api: {
      fetchChatSessions: (params) => {
        requests.push(params)
        return Promise.resolve({ records: params.pageNum === 1 ? [sessionRow(1, { isPinned: true }), sessionRow(2)] : [], total: '2', archiveIdleDays: 0 })
      },
      deleteChatSession: () => Promise.resolve(null),
      setChatSessionPinned: () => Promise.resolve(null)
    }
  })

  await page.reset()
  assert.equal(page.data.list.length, 2)

  // 操作表选"删除"（index=1）→ 走确认删除
  page.openActions({ id: '2', pinned: false })
  await flush()
  assert.equal(state.modals.length, 1)
  assert.equal(page.data.list.filter((item) => item.id === '2').length, 0)

  // 取消置顶
  page.togglePinned('1', false)
  await flush()
  assert.equal(json(state.calls.filter((c) => c.name === 'setChatSessionPinned').map((c) => c.args)),
    '[["1",false]]')
  assert.equal(page.data.list.find((item) => item.id === '1').isPinned, false)
  assert.equal(state.toasts[state.toasts.length - 1].title, '已取消置顶')

  // 下拉刷新：回到第一页重新拉
  await page.onPullDownRefresh()
  assert.equal(json(requests[requests.length - 1]), '{"pageNum":1,"pageSize":20}')

  // 空态里的「开始新对话」：通知对话页走新建
  page.onStartNewChat()
  assert.equal(state.app.globalData.pendingNewChat, true)
  assert.equal(state.navs[state.navs.length - 1].url, '/pages/voice/voice')
})

test('历史列表页首屏为空时不报错，且分页请求失败只提示不崩', async () => {
  let fail = true
  const { page, state } = createHistoryPage({
    api: {
      fetchChatSessions: () => (fail ? Promise.reject(new Error('网络异常')) : Promise.resolve({ records: [], total: '0', archiveIdleDays: 0 })),
      deleteChatSession: () => Promise.resolve(null),
      setChatSessionPinned: () => Promise.resolve(null)
    }
  })
  await page.onShow()
  assert.equal(page.data.loading, false)
  assert.equal(json(page.data.list), '[]')
  // 失败也算"加载过"：空态要显示出来，而不是一直空白
  assert.equal(page.data.loaded, true)
  assert.equal(state.toasts[state.toasts.length - 1].title, '网络异常')

  fail = false
  await page.reset()
  assert.equal(json(page.data.list), '[]')
  // 空的一页说明后面没有更多了
  assert.equal(page.data.hasMore, false)
})

// ------------------------------------------------------------------ 6. 接线与模板

test('接线：新页面已注册、独立小语与四项新导航兼容、入口与只读提示都在模板里', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(appJson.pages.includes('pages/voice/history'))
  // 采用本次用户指定的四项导航，小语是独立页面
  assert.equal(json(appJson.tabBar.list.map((item) => item.text)), '["记录","设备管理","社区","我的"]')
  assert.equal(json(appJson.tabBar.list.map((item) => item.pagePath)),
    '["pages/ai/ai","pages/devices/devices","pages/index/index","pages/mine/mine"]')

  const voiceWxml = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  for (const marker of ['bindtap="onOpenHistory"', 'bindtap="onNewChat"', '历史对话', '新对话',
    'disabled="{{sessionReadOnly}}"', 'sessionNotice', 'bindtap="onLoadEarlier"',
    // 原有 SSE / 重试 / 图片渲染不能丢
    'bindtap="onRetry"', 'wx-typing', 'bindtap="onPreviewImage"']) {
    assert.ok(voiceWxml.includes(marker), marker)
  }

  const historyWxml = fs.readFileSync(path.join(root, 'pages/voice/history.wxml'), 'utf8')
  for (const marker of ['这里是你和助手的全部对话记录', 'bindtap="onTapSession"', 'bindlongpress="onLongPress"',
    'catchtap="onMore"', '开始新对话', 'bindtap="onStartNewChat"', 'item.lastMessagePreview', 'item.timeText',
    'loaded && list.length === 0', '{{total}}']) {
    assert.ok(historyWxml.includes(marker), marker)
  }
  // 不能出现"模型只看最近 N 条"这类猜测性文案
  assert.equal(/最近\s*\d+\s*条/.test(historyWxml + voiceWxml), false)

  const historyJson = JSON.parse(fs.readFileSync(path.join(root, 'pages/voice/history.json'), 'utf8'))
  assert.equal(historyJson.enablePullDownRefresh, true)
  assert.equal(historyJson.navigationBarTitleText, 'AI 对话历史')

  const historyJs = fs.readFileSync(path.join(root, 'pages/voice/history.js'), 'utf8')
  assert.ok(historyJs.includes('删除后这段对话记录将不可恢复'))
  assert.ok(historyJs.includes('/pages/voice/voice'))

  // 「我的」页挂了一个二级入口；tabBar 本身不动
  const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8')
  assert.ok(mineWxml.includes('data-url="/pages/voice/history"'))
  assert.ok(mineWxml.includes('AI 对话历史'))
})
