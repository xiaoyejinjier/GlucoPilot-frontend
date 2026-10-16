const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const chatSessions = require('../../utils/chat-sessions')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const row = (id, extra = {}) => ({ id: String(id), seqNo: id, msgRole: id % 2 ? 1 : 2,
  msgType: 1, contentText: `message ${id}`, createdAt: '2026-10-16T10:30:00', ...extra })
function harness(fetch = async () => ({ records: [row(1), row(2)], hasMore: false })) {
  let definition
  const state = { token: 'user-one', fetches: [], sends: [], toasts: [], redirects: [], ticks: [], sessionCalls: 0 }
  const app = { globalData: { isLoggedIn: true } }
  const api = {
    getOrCreateChatSession: async () => ({ id: String(++state.sessionCalls) }),
    fetchChatHistory: (...args) => { state.fetches.push(args); return Promise.resolve(fetch(...args)).then(chatSessions.normalizeHistoryPage) },
    sendChatMessage: (...args) => { state.sends.push(args); return Promise.resolve({ id: '99' }) },
    streamChatCompletion: () => ({ abort() {} })
  }
  const dependencies = { '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../services/api': api, '../../utils/chat-sessions': chatSessions, '../../utils/media': {}, '../../utils/request': { getToken: () => state.token } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/voice.js'), 'utf8'), {
    Page: value => { definition = value }, getApp: () => app,
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
    setTimeout, clearTimeout, wx: {
      getWindowInfo: () => ({ windowHeight: 720 }),
      nextTick: callback => state.ticks.push(callback),
      showToast: value => state.toasts.push(value), reLaunch: value => state.redirects.push(value)
    }
  })
  const page = () => {
    const value = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
    value.onLoad(); value.onShow()
    return value
  }
  return { page, state, render: () => { while (state.ticks.length) state.ticks.shift()() } }
}

test('重新进入恢复服务器历史并在末尾显示完整欢迎卡片，不调用模型', async () => {
  const { page, state, render } = harness()
  const first = page()
  await flush(); render()
  assert.equal(first.data.historyReady, true)
  assert.equal(state.fetches[0][1].pageSize, 20)
  assert.equal(first.data.messages.length, 3)
  assert.equal(first.data.messages[0].content, 'message 1')
  assert.equal(first.data.messages[1].role, 'ai')
  assert.equal(first.data.messages[2].localWelcome, true)
  assert.equal(first.data.messages[2].type, 'welcome')
  assert.equal(first.data.hasHistory, true)
  assert.equal(first.data.messages[0].timeLabel, '2026-10-16 10:30')
  assert.equal(first.data.scrollIntoView, `message-${first.data.messages[2].id}`)
  first.onUnload()
  const second = page()
  await flush(); render()
  assert.equal(state.fetches.length, 2)
  assert.equal(second.data.messages.filter(m => m.localWelcome).length, 1)
  assert.equal(state.sends.length, 0)
})

test('首次无历史保留欢迎卡片，临时切到后台不重复追加欢迎语', async () => {
  const empty = harness(async () => ({ records: [], hasMore: false }))
  const page = empty.page(); await flush(); empty.render()
  assert.equal(page.data.messages.length, 0)
  assert.equal(page.data.scrollIntoView, '')
  assert.equal(page.data.historyReady, true)
  assert.equal(page.data.hasHistory, false)
  const returning = harness(); const current = returning.page(); await flush()
  current.onHide(); current.onShow(); await flush()
  assert.equal(current.data.messages.length, 3)
  assert.equal(returning.state.fetches.length, 1)
})

test('再次进入的欢迎卡片可填入示例，新消息接在卡片下面，键盘不滚走欢迎区', async () => {
  const { page, state, render } = harness()
  const current = page(); await flush(); render()
  const welcome = current.data.messages.at(-1)
  current.onInputFocus({ detail: { height: 300 } }); render()
  assert.equal(current.data.viewportHeight, 420)
  assert.equal(current.data.scrollIntoView, '')
  assert.equal(current.hasCurrentMessages(), false)
  current.onSuggestionTap({ currentTarget: { dataset: { index: '2' } } })
  assert.equal(current.data.inputValue, current.data.suggestions[2])
  assert.equal(state.sends.length, 0)
  current.onSend(); await flush()
  assert.equal(current.data.messages[2], welcome)
  assert.equal(current.data.messages[3].role, 'user')
  assert.equal(current.data.messages[3].content, current.data.suggestions[2])
  assert.equal(current.data.messages[4].role, 'ai')
  assert.equal(current.data.scrollIntoView, 'msg-bottom')
  assert.equal(current.hasCurrentMessages(), true)
  assert.equal(state.sends.length, 1)
})

test('初次与再次进入复用同一卡通及您可以说模板，欢迎卡片不套聊天气泡', () => {
  const source = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  const welcome = source.match(/<template name="assistantWelcome">([\s\S]*?)<\/template>/)[1]
  assert.match(welcome, /assistant-mascot variant="welcome"/)
  assert.match(welcome, /您好呀，我是小语/)
  assert.match(welcome, /您可以说/)
  assert.match(welcome, /bindtap="onSuggestionTap"/)
  assert.equal(source.match(/is="assistantWelcome"/g).length, 2)
  const entry = source.indexOf('wx:if="{{item.localWelcome}}"')
  assert.ok(entry > source.indexOf('wx:for="{{messages}}"'))
  assert.ok(source.indexOf('<block wx:else>', entry) < source.indexOf('class="wx-bubble"', entry))
})

test('加载完成前不能发送或选图，草稿保留；失败后可重试恢复', async () => {
  const pending = deferred()
  let attempts = 0
  const { page, state } = harness(() => ++attempts === 1 ? pending.promise : Promise.resolve({ records: [row(1)], hasMore: false }))
  const current = page(); await flush()
  current.onInput({ detail: { value: '我的草稿' } })
  current.onSend(); current.onChooseImage()
  assert.equal(current.data.inputValue, '我的草稿')
  assert.equal(state.sends.length, 0)
  pending.reject(new Error('offline')); await flush()
  assert.equal(current.data.historyReady, false)
  assert.match(current.data.historyError, /重试/)
  await current.onRetryHistory()
  assert.equal(current.data.historyReady, true)
  current.onSend(); await flush()
  assert.equal(state.sends.length, 1)
  assert.equal(current.data.messages.at(-2).content, '我的草稿')
  assert.equal(current.data.messages[0].content, 'message 1')
})

test('更早消息按游标前插并去重，保留新消息与滚动位置', async () => {
  const older = deferred()
  let n = 0
  const { page, state, render } = harness(() => ++n === 1 ? Promise.resolve({ records: [row(3), row(4)], hasMore: true, nextBeforeSeq: 3 }) : older.promise)
  const current = page(); await flush(); render()
  const welcome = current.data.messages.at(-1)
  const loading = current.onLoadOlderHistory()
  await flush()
  current.setData({ messages: current.data.messages.concat({ id: 'new', role: 'user', content: '新问题' }) })
  older.resolve({ records: [row(1), row(2), row(3)], hasMore: false })
  await loading; render()
  assert.equal(state.fetches[1][1].beforeSeq, 3)
  assert.equal(current.data.messages.map(m => m.id).join(','), `h1,h2,h3,h4,${welcome.id},new`)
  assert.equal(current.data.scrollIntoView, 'message-h3')
  assert.equal(current.data.historyHasMore, false)
})

test('隐藏后忽略迟到响应，返回重读；切换账号不显示旧记录', async () => {
  const first = deferred(), second = deferred()
  let n = 0
  const { page, state } = harness(() => ++n === 1 ? first.promise : second.promise)
  const current = page(); await flush()
  current.onHide(); first.resolve({ records: [row(1)], hasMore: false }); await flush()
  assert.equal(current.data.messages.length, 0)
  state.token = 'user-two'; current.onShow(); await flush()
  second.resolve({ records: [row(8)], hasMore: false }); await flush()
  assert.equal(current.data.messages[0].content, 'message 8')
  assert.equal(state.sessionCalls, 2)
})

test('账号在响应前变化会丢弃旧历史，401 引导重新登录', async () => {
  const pending = deferred()
  const { page, state } = harness(() => pending.promise)
  const current = page(); await flush()
  state.token = 'user-two'; pending.resolve({ records: [row(1)], hasMore: false }); await flush()
  assert.equal(current.data.messages.length, 0)
  const expired = harness(async () => { expired.state.token = ''; throw Object.assign(new Error('expired'), { code: 40100 }) })
  expired.page(); await flush()
  assert.equal(expired.state.redirects[0].url, '/pages/login/login')
})

test('图片地址从服务端恢复，失效图片和语音仍有可读占位', async () => {
  const { page } = harness(async () => ({ records: [
    row(1, { msgType: 2, mediaUrl: 'https://example.invalid/image.jpg', mediaId: '9007199254740993', contentText: '早餐' }),
    row(2, { msgType: 2, fileUrl: null, contentText: '' }), row(3, { msgType: 3, contentText: '' })
  ], hasMore: false }))
  const current = page(); await flush()
  assert.equal(current.data.messages[0].mediaId, '9007199254740993')
  assert.equal(current.data.messages[0].fileUrl, 'https://example.invalid/image.jpg')
  assert.equal(current.data.messages[1].imageUnavailable, true)
  assert.match(current.data.messages[2].content, /语音消息/)
})
