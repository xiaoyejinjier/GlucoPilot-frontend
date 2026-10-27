const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function createPage() {
  let definition
  const state = { windowHeight: 720, nextTicks: [], listeners: new Set(), removed: [], sends: [] }
  const wx = {
    getWindowInfo: () => ({ windowHeight: state.windowHeight }),
    onKeyboardHeightChange: (handler) => state.listeners.add(handler),
    offKeyboardHeightChange: (handler) => { state.removed.push(handler); state.listeners.delete(handler) },
    nextTick: (callback) => state.nextTicks.push(callback)
  }
  const dependencies = {
    '../../utils/locales/en': require('../../utils/locales/en'),
    '../../utils/display': { applyDisplayToCurrentPage() {} },
    '../../services/api': { getOrCreateChatSession: async () => ({ id: 1 }) },
    '../../utils/media': {},
    '../../utils/chat-sessions': require('../../utils/chat-sessions'),
    '../../utils/request': { getToken: () => 'test-token' }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/voice.js'), 'utf8'), {
    Page: (value) => { definition = value },
    getApp: () => ({ globalData: { isLoggedIn: true } }),
    require: (name) => { assert.ok(dependencies[name], name); return dependencies[name] },
    wx, setTimeout, clearTimeout
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
  page.onLoad()
  // 本组只验证键盘布局，历史读取由 voice-history.test.cjs 覆盖。
  page.setData({ historyReady: true })
  page.onShow()
  const render = () => { while (state.nextTicks.length) state.nextTicks.shift()() }
  const resize = (height) => { state.windowHeight = height; page.onResize({ size: { windowHeight: height } }) }
  return { page, state, render, resize }
}

test('键盘覆盖窗口时同步缩小整个聊天页面，重复聚焦仍滚动到最新消息', () => {
  const { page, render } = createPage()
  page.setData({ messages: [{ id: 'existing', role: 'user', content: '已发送的问题' }] })
  page.updateChatViewport()
  assert.equal(page.data.viewportHeight, 720)
  render()
  assert.equal(page.data.scrollIntoView, 'msg-bottom')
  const messages = page.data.messages
  page.onInputFocus({ detail: { height: 300 } })
  assert.equal(page.data.viewportHeight, 420)
  assert.equal(page.data.keyboardHeight, 300)
  assert.equal(page.data.messages, messages)
  assert.equal(page.data.scrollIntoView, '')
  render()
  assert.equal(page.data.scrollIntoView, 'msg-bottom')
  page.onInputFocus({ detail: { height: 300 } })
  assert.equal(page.data.scrollIntoView, '')
  render()
  assert.equal(page.data.scrollIntoView, 'msg-bottom')
})

test('欢迎界面初始不伪造聊天消息，键盘展开不自动滚动欢迎卡片', () => {
  const { page, render } = createPage()
  assert.equal(page.data.messages.length, 0)
  assert.equal(page.data.suggestions.length, 5)
  render()
  assert.equal(page.data.scrollIntoView, '')
  page.onInputFocus({ detail: { height: 300 } })
  render()
  assert.equal(page.data.viewportHeight, 420)
  assert.equal(page.data.scrollIntoView, '')
  assert.equal(page.data.messages.length, 0)
  const template = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  assert.match(template, /您好呀，我是小语/)
  assert.equal(template.includes('小诺'), false)
})

test('示例问题仅填入草稿，发送后对话追加在持续保留的欢迎内容下方', () => {
  const { page, state } = createPage()
  const selected = page.data.suggestions[1]
  page.setData({ voiceMode: true })
  page.onSuggestionTap({ currentTarget: { dataset: { index: '1' } } })
  assert.equal(page.data.inputValue, selected)
  assert.equal(page.data.inputFocus, true)
  assert.equal(page.data.voiceMode, false)
  assert.equal(page.data.messages.length, 0)
  assert.equal(state.sends.length, 0)
  page.startRound = (payload) => state.sends.push(payload)
  page.onSend()
  assert.equal(page.data.messages.length, 2)
  assert.equal(page.data.messages[0].content, selected)
  assert.equal(state.sends.length, 1)
  assert.equal(state.sends[0].contentText, selected)
  assert.equal(page.data.inputValue, '')
  const template = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  const welcome = template.indexOf('<template wx:if="{{!hasHistory && !sessionReadOnly}}" is="assistantWelcome"')
  const conversation = template.indexOf('<view wx:if="{{messages.length}}" class="wx-messages">')
  const bottom = template.indexOf('id="msg-bottom"')
  assert.ok(welcome >= 0 && conversation > welcome && bottom > conversation)
  assert.equal(page.data.scrollIntoView, 'msg-bottom')
})

test('非法示例索引或正在回复时不改写输入，键盘失焦同步焦点状态', () => {
  const { page } = createPage()
  page.setData({ inputValue: '保留的草稿' })
  for (const index of [-1, 5, 1.2, 'invalid', undefined]) {
    page.onSuggestionTap({ currentTarget: { dataset: { index } } })
    assert.equal(page.data.inputValue, '保留的草稿')
  }
  page.setData({ sending: true })
  page.onSuggestionTap({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.inputValue, '保留的草稿')
  page.onInputFocus({ detail: {} })
  assert.equal(page.data.inputFocus, true)
  page.onInputBlur()
  assert.equal(page.data.inputFocus, false)
})

test('系统先缩小窗口再通知键盘高度时只扣减一次，收起后恢复完整高度', () => {
  const { page, resize } = createPage()
  page.onInputFocus({ detail: {} })
  resize(420)
  assert.equal(page.data.viewportHeight, 420)
  page.onKeyboardHeightChange({ height: 300 })
  assert.equal(page.data.viewportHeight, 420)
  page.onInputBlur()
  page.onKeyboardHeightChange({ height: 0 })
  resize(720)
  assert.equal(page.data.viewportHeight, 720)
  assert.equal(page.data.keyboardHeight, 0)
})

test('先通知键盘高度再缩小窗口以及切换输入法高度不会重复扣减', () => {
  const { page, resize } = createPage()
  page.onInputFocus({ detail: {} })
  page.onKeyboardHeightChange({ detail: { height: 300 } })
  resize(420)
  assert.equal(page.data.viewportHeight, 420)
  page.onKeyboardHeightChange({ height: 320 })
  resize(400)
  assert.equal(page.data.viewportHeight, 400)
  page.onInputBlur()
  resize(720)
  page.onKeyboardHeightChange({ height: 0 })
  assert.equal(page.data.viewportHeight, 720)
})

test('无效键盘高度不改变布局，输入草稿不因键盘开关丢失', () => {
  const { page } = createPage()
  page.onInput({ detail: { value: '想咨询的问题' } })
  for (const height of [-1, NaN, Infinity, 'invalid', undefined]) page.onKeyboardHeightChange({ height })
  assert.equal(page.data.viewportHeight, 720)
  assert.equal(page.data.keyboardHeight, 0)
  page.onKeyboardHeightChange({ height: 300 })
  page.onKeyboardHeightChange({ height: 0 })
  assert.equal(page.data.viewportHeight, 720)
  assert.equal(page.data.inputValue, '想咨询的问题')
})

test('隐藏/退出注销同一键盘监听并阻止晚回调，返回后只注册一次', () => {
  const { page, state, render } = createPage()
  assert.equal(state.listeners.size, 1)
  const listener = [...state.listeners][0]
  listener({ height: 300 })
  page.onHide()
  assert.equal(state.listeners.size, 0)
  assert.equal(state.removed[0], listener)
  const hidden = JSON.stringify(page.data)
  listener({ height: 350 })
  render()
  assert.equal(JSON.stringify(page.data), hidden)
  page.onShow()
  page.onShow()
  assert.equal(state.listeners.size, 1)
  assert.equal(page.data.viewportHeight, 720)
  page.onUnload()
  assert.equal(state.listeners.size, 0)
  render()
})

test('窗口正常缩放会更新聊天高度，模板关闭自动顶起并绑定键盘事件', () => {
  const { page, resize } = createPage()
  resize(600)
  assert.equal(page.data.viewportHeight, 600)
  page.onInputFocus({ detail: { height: 250 } })
  assert.equal(page.data.viewportHeight, 350)
  const template = fs.readFileSync(path.join(root, 'pages/voice/voice.wxml'), 'utf8')
  assert.match(template, /adjust-position="\{\{false\}\}"/)
  assert.match(template, /bindkeyboardheightchange="onKeyboardHeightChange"/)
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/voice/voice.json'), 'utf8'))
  assert.equal(config.disableScroll, true)
})
