const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function harness(options = {}) {
  const state = { token: 'account-one', events: [], starts: [], stops: 0, calls: [], removed: [], auth: 0, routes: [], clocks: new Map() }
  const native = {
    onStart(fn) { this.started = fn }, onStop(fn) { this.stopped = fn }, onError(fn) { this.failed = fn },
    onInterruptionBegin(fn) { this.interrupted = fn }, start(value) { state.starts.push(value) }, stop() { state.stops++ }
  }
  const wx = {
    getRecorderManager: () => native,
    authorize(value) { state.auth++; if (options.authorize) options.authorize(value); else value.success() },
    getFileSystemManager: () => ({
      readFile(value) { if (options.readFile) options.readFile(value); else value.success({ data: 'SUQzBA==' }) },
      unlink(value) { state.removed.push(value.filePath) }
    }), reLaunch(value) { state.routes.push(value.url) }, openSetting() { state.settings = true }
  }
  const recorderModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/speech-recorder.js'), 'utf8'), { module: recorderModule, wx })
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/speech-input/speech-input.js'), 'utf8'), {
    Component: value => { definition = value }, wx,
    require(name) {
      if (name === '../../utils/speech-recorder') return recorderModule.exports
      if (name === '../../utils/request') return { getToken: () => state.token }
      assert.equal(name, '../../services/api')
      return { async transcribeSpeech(payload) { state.calls.push(payload); return options.transcribe ? options.transcribe(payload) : { text: '空腹血糖5.2' } } }
    },
    setInterval(fn) { const id = state.clocks.size + 1; state.clocks.set(id, fn); return id },
    clearInterval(id) { state.clocks.delete(id) }
  })
  function component() {
    const input = { ...definition.methods, data: { ...JSON.parse(JSON.stringify(definition.data)), visible: false, draft: options.draft || '', disabled: false },
      setData(value) { Object.assign(this.data, value) }, triggerEvent(name, detail) { state.events.push({ name, detail }) } }
    input.visible = value => { input.setData({ visible: value }); definition.properties.visible.observer.call(input, value) }
    input.hide = () => { definition.pageLifetimes.hide.call(input); input.visible(false) }
    input.detach = () => { definition.lifetimes.detached.call(input); input.visible(false) }
    input.visible(true)
    return input
  }
  const stop = (extra = {}) => native.stopped({ tempFilePath: 'record.mp3', duration: 2000, fileSize: 1000, ...extra })
  return { state, native, component, stop, recorder: recorderModule.exports }
}

test('切换模式不自动录音，按住说话才授权并启用原生MP3录音', async () => {
  const { state, component, native } = harness()
  const input = component()
  assert.equal(input.data.phase, 'ready')
  assert.equal(state.auth + state.starts.length + state.calls.length, 0)
  await input.beginHold()
  assert.equal(state.auth, 1)
  assert.equal(state.starts[0].duration, 60000)
  assert.equal(state.starts[0].format, 'mp3')
  assert.equal(input.data.phase, 'authorizing')
  native.started()
  assert.equal(input.data.phase, 'recording')
  for (const clock of state.clocks.values()) clock()
  assert.equal(input.data.seconds, 1)
})

test('说完后真实转写并展示文字，允许修改，只有确认后才触发一次发送意图', async () => {
  const { state, component, native, stop } = harness({ draft: '帮我记录今天的情况' })
  const input = component()
  await input.start(); native.started(); input.stop()
  assert.equal(input.data.phase, 'stopping')
  assert.equal(state.calls.length, 0)
  stop(); await flush()
  assert.equal(input.data.phase, 'review')
  assert.equal(input.data.text, '帮我记录今天的情况\n空腹血糖5.2')
  assert.equal(state.calls[0].format, 'mp3')
  assert.equal(state.calls[0].durationMs, 2000)
  assert.equal(state.events.length, 0)
  assert.equal(state.clocks.size, 0)
  assert.deepEqual(state.removed, ['record.mp3'])
  input.edit({ detail: { value: '我确认：空腹血糖5.3' } })
  input.confirm(); input.confirm()
  assert.equal(state.events.length, 1)
  assert.equal(state.events[0].name, 'confirm')
  assert.equal(state.events[0].detail.text, '我确认：空腹血糖5.3')
})

test('重录替换上一段识别结果，取消保留父级原草稿且不发送', async () => {
  let count = 0
  const { state, component, native, stop } = harness({ draft: '草稿', transcribe: async () => ({ text: ++count === 1 ? '第一段' : '第二段' }) })
  const input = component()
  await input.start(); native.started(); stop(); await flush()
  await input.start(); native.started(); stop(); await flush()
  assert.equal(input.data.text, '草稿\n第二段')
  assert.equal(input.data.draft, '草稿')
  input.close()
  assert.equal(state.events.some(event => event.name === 'confirm'), false)
  assert.equal(state.events.at(-1).name, 'close')
})

test('键盘或父级重复同步visible时，保留已识别文本与编辑结果', async () => {
  const { component, native, stop } = harness(), input = component()
  await input.start(); native.started(); stop(); await flush()
  input.edit({ detail: { value: '修改后的血糖记录5.3' } })
  input.setData({ viewportHeight: 320 })
  input.visible(true)
  assert.equal(input.data.phase, 'review')
  assert.equal(input.data.text, '修改后的血糖记录5.3')
})

test('拒绝授权后显示开启权限入口，不开始录音；授权慢回调遇到取消时被丢弃', async () => {
  const denied = harness({ authorize: value => value.fail() }), input = denied.component()
  await input.start()
  assert.equal(input.data.phase, 'error')
  assert.equal(input.data.permissionDenied, true)
  assert.equal(denied.state.starts.length, 0)
  input.openSettings(); assert.equal(denied.state.settings, true)
  let grant
  const pending = harness({ authorize: value => { grant = value.success } }), other = pending.component()
  const start = other.start()
  other.close(); other.visible(false); grant(); await start
  assert.equal(pending.state.starts.length, 0)
})

test('录音取消或页面隐藏后停止麦克风，旧stop不会被新录音误识别', async () => {
  const { state, component, native, stop } = harness()
  const first = component()
  await first.start(); native.started(); first.hide()
  assert.equal(state.stops, 1)
  assert.equal(state.clocks.size, 0)
  const next = component()
  await next.start()
  assert.equal(next.data.phase, 'error')
  assert.match(next.data.error, /上一段/)
  stop(); await flush()
  assert.equal(state.calls.length, 0)
  await next.start(); native.started(); stop(); await flush()
  assert.equal(state.calls.length, 1)
  assert.equal(next.data.phase, 'review')
})

test('开始录音回调到来之前取消，稍后收到start会立即停止且不转写', async () => {
  const { state, component, native, stop } = harness()
  const input = component()
  await input.start(); input.close(); input.visible(false)
  assert.equal(state.stops, 0)
  native.started(); assert.equal(state.stops, 1)
  stop(); await flush()
  assert.equal(state.calls.length, 0)
})

test('录音中断不识别残缺音频；正常60秒自动停止后才给出待确认结果', async () => {
  const interrupted = harness(), input = interrupted.component()
  await input.start(); interrupted.native.started(); interrupted.native.interrupted()
  assert.equal(input.data.phase, 'error')
  assert.match(input.data.error, /中断/)
  interrupted.stop(); await flush()
  assert.equal(interrupted.state.calls.length, 0)
  const automatic = harness(), other = automatic.component()
  await other.start(); automatic.native.started(); automatic.stop({ duration: 60000 }); await flush()
  assert.equal(other.data.phase, 'review')
  assert.equal(automatic.state.calls[0].durationMs, 60000)
  assert.equal(automatic.state.events.length, 0)
})

test('过短、过大和无法读取的录音不会发给识别服务，始终清理临时文件', async () => {
  for (const extra of [{ duration: 200 }, { fileSize: 600000 }]) {
    const { state, component, native, stop } = harness(), input = component()
    await input.start(); native.started(); stop(extra); await flush()
    assert.equal(input.data.phase, 'error')
    assert.equal(state.calls.length, 0)
    assert.deepEqual(state.removed, ['record.mp3'])
  }
  const failed = harness({ readFile: value => value.fail() }), input = failed.component()
  await input.start(); failed.native.started(); failed.stop(); await flush()
  assert.match(input.data.error, /无法读取/)
  assert.equal(failed.state.calls.length, 0)
})

test('空识别或接口失败允许重录，不伪造文字或自动发送', async () => {
  for (const transcribe of [async () => ({ text: '' }), async () => { throw new Error('服务未配置') }]) {
    const { state, component, native, stop } = harness({ transcribe }), input = component()
    await input.start(); native.started(); stop(); await flush()
    assert.equal(input.data.phase, 'error')
    assert.equal(state.events.length, 0)
    assert.equal(input.data.text, '')
  }
})

test('退出、切换账号或重新打开面板后，迟到的转写结果不能回填或发送', async () => {
  for (const action of ['hide', 'account', 'reopen']) {
    const response = deferred(), current = harness({ transcribe: () => response.promise }), input = current.component()
    await input.start(); current.native.started(); current.stop(); await flush()
    if (action === 'hide') input.hide()
    if (action === 'account') current.state.token = 'account-two'
    if (action === 'reopen') { input.visible(false); input.visible(true) }
    response.resolve({ text: '旧账号的内容' }); await flush()
    assert.equal(input.data.text, '')
    assert.equal(current.state.events.some(event => event.name === 'confirm'), false)
  }
})

test('识别401返回登录，确认时账户变化或只读/回复中不能发送', async () => {
  let current
  current = harness({ transcribe: async () => { current.state.token = ''; throw Object.assign(new Error('expired'), { code: 40100 }) } })
  const input = current.component()
  await input.start(); current.native.started(); current.stop(); await flush()
  assert.equal(current.state.routes[0], '/pages/login/login')
  const another = harness(), review = another.component()
  await review.start(); another.native.started(); another.stop(); await flush()
  review.setData({ disabled: true }); review.confirm()
  review.setData({ disabled: false }); another.state.token = 'account-two'; review.confirm()
  assert.equal(another.state.events.some(event => event.name === 'confirm'), false)
})

function voicePage(deferRender = false) {
  let definition
  const app = { globalData: { isLoggedIn: true } }, sent = [], gestures = [], renders = []
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/voice/voice.js'), 'utf8'), {
    Page: value => { definition = value }, getApp: () => app, wx: { hideKeyboard() {} },
    require: name => name.endsWith('/request') ? { getToken: () => 'account-one' } : {}, clearTimeout() {}
  })
  const page = { ...definition, _historyToken: 'account-one', data: { ...JSON.parse(JSON.stringify(definition.data)), inputValue: '旧草稿', historyReady: true },
    setData(value, callback) { Object.assign(this.data, value); if (callback) { if (deferRender) renders.push(callback); else callback() } },
    selectComponent: () => ({ beginHold() { gestures.push('start') }, endHold(cancelled) { gestures.push(cancelled ? 'cancel' : 'end') } }),
    canSend: () => true, sendText: text => sent.push(text) }
  return { page, sent, gestures, renders }
}

test('页面先切换按住说话，再按住录音松开识别，确认后只发送一次并保留语音模式', () => {
  const { page, sent, gestures } = voicePage()
  page.onToggleVoiceMode()
  assert.equal(page.data.voiceMode, true)
  assert.equal(page.data.speechVisible, false)
  assert.equal(gestures.length, 0)
  assert.equal(sent.length, 0)
  page.onCloseSpeechInput()
  assert.equal(page.data.inputValue, '旧草稿')
  page.onHoldStart({ touches: [{}] })
  assert.equal(page.data.speechVisible, true)
  assert.equal(page.data.holdingSpeech, true)
  assert.deepEqual(gestures, ['start'])
  page.onHoldEnd()
  page.onHoldEnd() // 根视图的兜底touchend不重复停止。
  assert.deepEqual(gestures, ['start', 'end'])
  assert.equal(sent.length, 0)
  page.onConfirmSpeechInput({ detail: { text: '旧草稿\n用户确认后的文字' } })
  assert.deepEqual(sent, ['旧草稿\n用户确认后的文字'])
  page.onConfirmSpeechInput({ detail: { text: '重复事件' } })
  assert.equal(sent.length, 1)
  assert.equal(page.data.voiceMode, true)
  assert.equal(page.data.speechVisible, false)
  assert.equal(page.data.inputValue, '')
})

test('按下后渲染未完成就松手，不延迟启动麦克风或留下录音面板', () => {
  const { page, gestures, renders } = voicePage(true)
  page.onToggleVoiceMode()
  page.onHoldStart({ touches: [{}] })
  page.onHoldEnd()
  for (const render of renders) render()
  assert.equal(gestures.length, 0)
  assert.equal(page.data.speechVisible, false)
  assert.equal(page.data.voiceMode, true)
})

test('触摸取消只取消一次，切回键盘保留草稿且不会被加载状态挡住', () => {
  const { page, gestures, sent } = voicePage()
  page.onToggleVoiceMode()
  page.onHoldStart({ touches: [{}, {}] })
  assert.equal(gestures.length, 0)
  page.onHoldStart({ touches: [{}] })
  page.onHoldCancel(); page.onHoldCancel()
  assert.deepEqual(gestures, ['start', 'cancel'])
  assert.equal(page.data.speechVisible, false)
  assert.equal(sent.length, 0)
  page.canSend = () => false
  page.onToggleVoiceMode()
  assert.equal(page.data.voiceMode, false)
  assert.equal(page.data.inputValue, '旧草稿')
  assert.equal(page.data.inputFocus, true)
})

test('松手立即停止，原生开始回调延迟时也会在开始后立刻结束', async () => {
  const current = harness(), input = current.component()
  await input.beginHold(); current.native.started(); input.endHold()
  assert.equal(input.data.phase, 'stopping')
  assert.equal(current.state.stops, 1)
  input.endHold()
  assert.equal(current.state.stops, 1)
  current.stop(); await flush()
  assert.equal(input.data.phase, 'review')
  assert.equal(current.state.events.length, 0)

  const delayed = harness(), other = delayed.component()
  await other.beginHold(); other.endHold()
  assert.equal(delayed.state.stops, 0)
  delayed.native.started()
  assert.equal(delayed.state.stops, 1)
  delayed.stop(); await flush()
  assert.equal(other.data.phase, 'review')
})

test('首次授权期间松手不在授权后启动麦克风；系统取消触摸也不识别', async () => {
  let grant
  const current = harness({ authorize: value => { grant = value.success } }), input = current.component()
  const pending = input.beginHold()
  input.endHold(); grant(); await pending
  assert.equal(current.state.starts.length, 0)
  assert.equal(current.state.events.at(-1).name, 'close')
  const cancelled = harness(), other = cancelled.component()
  await other.beginHold(); cancelled.native.started(); other.endHold(true)
  cancelled.stop(); await flush()
  assert.equal(cancelled.state.calls.length, 0)
  assert.equal(cancelled.state.events.some(event => event.name === 'confirm'), false)
})

test('识别后重新录音只回到按住说话，不会自动开始录音或发送', async () => {
  const current = harness(), input = current.component()
  await input.beginHold(); current.native.started(); input.endHold(); current.stop(); await flush()
  input.retry()
  assert.equal(current.state.starts.length, 1)
  assert.equal(current.state.events.at(-1).name, 'close')
  assert.equal(current.state.events.some(event => event.name === 'confirm'), false)
  const template = fs.readFileSync(path.join(root, 'components/speech-input/speech-input.wxml'), 'utf8')
  assert.match(template, /bindtap="retry"[^>]*>{{i18n\.t\("重新录音", locale\)}}/)
  assert.equal(template.includes('bindtap="start"'), false)
  assert.equal(template.includes('bindtap="stop"'), false)
})

test('转写API有鉴权和有限超时，不调用聊天发送或上传音频到对象存储', async () => {
  const calls = [], module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/api.js'), 'utf8'), {
    module, require: name => name === '../utils/request' ? { post: async (...args) => { calls.push(args); return { text: '真实转写' } } } : {}
  })
  const result = await module.exports.transcribeSpeech({ audioBase64: 'SUQzBA==', format: 'mp3', durationMs: 2000 })
  assert.equal(result.text, '真实转写')
  assert.equal(calls[0][0], '/speech-transcriptions')
  assert.equal(calls[0][2].auth, true)
  assert.equal(calls[0][2].timeout, 60000)
})
