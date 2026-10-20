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
  const api = {
    getOrCreateChatSession: () => Promise.resolve({ id: '48' }),
    sendChatMessage: () => Promise.resolve({ id: '101' }),
    ...options.api
  }
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

test('会话状态重置后旧发送回调不能启动旧模型回复', async () => {
  let complete
  const saved = new Promise(resolve => { complete = resolve })
  const { page, state } = createChatPage({ api: { sendChatMessage: () => saved } })
  page.onLoad({ sessionId: '48', sessionStatus: '1' }); page.onShow(); await flush()
  page.onInput({ detail: { value: '旧会话问题' } }); page.onSend(); await flush()
  assert.equal(state.calls.filter(call => call.name === 'sendChatMessage').length, 1)
  page.resetToFresh()
  page.setData({ sessionId: '77' })
  await page.loadHistory()
  complete({ id: '101' }); await flush()
  assert.equal(page.data.sessionId, '77')
  assert.equal(page.data.sending, false)
  assert.equal(state.calls.filter(call => call.name === 'streamChatCompletion').length, 0)
})

test('会话状态重置后旧图片上传结果不能写入当前对话', async () => {
  let complete
  const uploaded = new Promise(resolve => { complete = resolve })
  const { page, state } = createChatPage({ uploadChatImage: () => uploaded })
  page.onLoad({ sessionId: '48', sessionStatus: '1' }); page.onShow(); await flush()
  page.sendImage('/temporary-old-image.jpg')
  page.resetToFresh()
  page.setData({ sessionId: '77' })
  await page.loadHistory()
  complete({ id: '9', fileUrl: 'https://example.invalid/old.jpg' }); await flush()
  assert.equal(page.data.sessionId, '77')
  assert.equal(page.data.messages.length, 0)
  assert.equal(state.calls.filter(call => call.name === 'sendChatMessage').length, 0)
})

test('服务端当前会话已结束时仍保护只读状态，不发送消息', async () => {
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
      getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 2 }),
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
  assert.ok(page.data.sessionNotice.includes('已结束') && page.data.sessionNotice.includes('重新进入'))

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

test('进入时自动恢复当前会话，忽略旧历史选择和新建意图', async () => {
  const { page, state } = createChatPage({ api: {
    getOrCreateChatSession: () => Promise.resolve({ id: '48', sessionStatus: 1 }),
    createChatSession: () => { throw new Error('不能强制新建对话') }
  } })
  state.app.globalData.pendingChatSession = { id: '77', sessionStatus: 2 }
  state.app.globalData.pendingNewChat = true
  page.onLoad({ sessionId: '99', sessionStatus: '2' })
  page.onShow()
  await flush()
  assert.equal(page.data.sessionId, '48')
  assert.equal(page.data.sessionReadOnly, false)
  assert.equal(page.data.historyReady, true)
  assert.equal(json(state.calls.map(call => call.name)), '["getOrCreateChatSession","fetchChatHistory"]')
  assert.equal(state.calls[1].args[0], '48')
  assert.equal(page.onNewChat, undefined)
  assert.equal(page.onOpenHistory, undefined)
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

test('自动恢复后继续发送文本并保留SSE回复链路', async () => {
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

test('当前对话不可用（404）时清理旧状态并保留重试入口', async () => {
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
  assert.match(page.data.historyError, /点击重试恢复/)
})

test('小语只保留自动恢复，导航与输入功能正常，已移除自选会话入口和路由', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(appJson.pages.includes('pages/voice/history'), false)
  assert.equal(json(appJson.tabBar.list.map(item => item.text)), '["记录","设备管理","社区","我的"]')
  const voiceWxml = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  for (const marker of ['onOpenHistory', 'onNewChat', '历史对话', '新对话', 'wx-head-actions']) {
    assert.equal(voiceWxml.includes(marker), false, marker)
  }
  for (const marker of ['bindtap="onLoadEarlier"', 'bindtap="onRetry"', 'wx-typing',
    'bindtap="onPreviewImage"', 'speech-input', 'sessionNotice']) assert.ok(voiceWxml.includes(marker), marker)
  const mine = fs.readFileSync(path.join(root, 'pages/mine/mine.wxml'), 'utf8')
  assert.equal(mine.includes('/pages/voice/history'), false)
  assert.equal(mine.includes('AI 对话历史'), false)
})
