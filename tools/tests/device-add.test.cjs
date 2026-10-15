const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function createDraftStore() {
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/device-drafts.js'), 'utf8'), sandbox)
  return sandbox.module.exports
}

test('扫码只接受受约束SN/JSON/带SN的URL，非法码拒绝且没有链接请求', () => {
  const store = createDraftStore()
  assert.equal(store.parseDeviceCode(' SN: AbC-1234 ').sn, 'AbC-1234')
  assert.equal(store.parseDeviceCode('{"sn":"001_abc","deviceName":"我的设备"}').name, '我的设备')
  assert.equal(store.parseDeviceCode('https://example.invalid/setup?sn=SN1234').sn, 'SN1234')
  for (const value of ['', 'abc', '{}', '{bad}', '{"sn":1234}', 'https://example.invalid/setup', 'https://example.invalid/?sn=%xx', '<script>alert(1)</script>', 'x'.repeat(2049)]) {
    assert.throws(() => store.parseDeviceCode(value))
  }
  assert.throws(() => store.validateSerial('contains space'))
  assert.equal(store.validateSerial('0'.repeat(64)).length, 64)
  assert.throws(() => store.validateSerial('0'.repeat(65)))
})

test('登记仅为会话内待适配，SN扫码去重、返回副本、防账号串数据', () => {
  const store = createDraftStore()
  assert.throws(() => store.addDeviceDraft('', { sn: 'SN1234' }))
  const first = store.addDeviceDraft('a', { sn: 'SN1234', source: 'scan', name: '我的设备' })
  assert.equal(first[0].status, 'pending')
  assert.equal(first[0].sourceText, '扫码登记')
  assert.equal(Object.hasOwn(first[0], 'glucoseValue'), false)
  assert.throws(() => store.addDeviceDraft('a', { sn: 'SN1234', source: 'sn' }))
  first[0].status = 'connected'
  assert.equal(store.listDeviceDrafts('a')[0].status, 'pending')
  const ble = store.addDeviceDraft('a', { deviceId: 'dev-a', source: 'bluetooth', name: '蓝牙设备' })
  assert.equal(ble.length, 2)
  assert.equal(store.removeDeviceDraft('a', ble[0].id).length, 1)
  assert.equal(store.listDeviceDrafts('b').length, 0)
  assert.equal(store.listDeviceDrafts('a').length, 0)
})

function createPage() {
  let definition
  const state = { token: 'user-a', scan: null, modal: null, toasts: [], scannerStart: 0, scannerStop: 0, nav: [] }
  const store = createDraftStore()
  const scanner = { start() { state.scannerStart++ }, stop() { state.scannerStop++ } }
  const wx = {
    getDeviceInfo: () => ({ platform: 'ios' }), onBluetoothDeviceFound() {},
    showToast: (item) => state.toasts.push(item), showModal: (item) => { state.modal = item },
    scanCode: (options) => { state.scan = options }, openSetting() {},
    navigateBack(options) { options.fail() }, switchTab(item) { state.nav.push(item) }
  }
  const dependencies = {
    '../../utils/display': { applyDisplayToCurrentPage() {} }, '../../utils/request': { getToken: () => state.token },
    '../../services/device-discovery': { createDeviceDiscovery: (callbacks) => { state.callbacks = callbacks; return scanner } },
    '../../utils/device-drafts': store
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/device-add/device-add.js'), 'utf8'), {
    Page(value) { definition = value }, wx, require: (name) => { assert.ok(dependencies[name], name); return dependencies[name] }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(value) { Object.assign(this.data, value) } }
  page.onLoad(); page.onShow()
  return { page, state, wx, store }
}

test('页面不自动扫描，搜索由用户触发，离页停止并屏蔽晚回调', () => {
  const { page, state } = createPage()
  assert.equal(state.scannerStart, 0)
  page.onSearch()
  assert.equal(state.scannerStart, 1)
  page.onHide()
  assert.equal(state.scannerStop, 1)
  state.callbacks.onDevices([{ deviceId: 'late' }])
  assert.equal(page.data.devices.length, 0)
  page.onUnload()
  assert.equal(state.scannerStop, 2)
})

test('扫码只预填SN待确认，系统相机hide/show后仍可确认，取消不登记', () => {
  const { page, state } = createPage()
  page.onScanAdd(); page.onHide()
  state.scan.success({ result: 'SN1234' }); state.scan.complete()
  assert.equal(page.data.drafts.length, 0)
  page.onShow()
  assert.equal(page.data.snVisible, true)
  assert.equal(page.data.snInput, 'SN1234')
  page.onCloseSerial()
  assert.equal(page.data.drafts.length, 0)
  page.onSnAdd(); page.onSnInput({ detail: { value: 'SN2345' } }); page.onSaveSerial()
  assert.equal(page.data.drafts[0].status, 'pending')
  assert.equal(page.data.snVisible, false)
})

test('扫码取消无错误、错误格式可重试，切换账号或退出后旧扫码不能回写', () => {
  const { page, state } = createPage()
  page.onScanAdd(); state.scan.fail({ errMsg: 'scanCode:fail cancel' }); state.scan.complete()
  assert.equal(page.data.scanError, '')
  page.onScanAdd(); state.scan.success({ result: 'https://example.invalid' }); state.scan.complete()
  assert.match(page.data.scanError, /未找到 SN/)
  page.onScanAdd()
  state.token = 'user-b'; page.onShow()
  state.scan.success({ result: 'SN3456' }); state.scan.complete()
  assert.equal(page.data.snVisible, false)
  assert.equal(page.data.drafts.length, 0)
  page.onScanAdd(); page.onUnload(); state.scan.success({ result: 'SN3456' })
  assert.equal(page.data.snVisible, false)
})

test('附近设备登记需确认、不是配对成功，账号变化时旧确认失效', () => {
  const { page, state } = createPage()
  page.setData({ devices: [{ deviceId: 'ble-a', name: 'Nearby' }] })
  page.onChooseDevice({ currentTarget: { dataset: { id: 'ble-a' } } })
  assert.equal(page.data.drafts.length, 0)
  state.modal.success({ confirm: true })
  assert.equal(page.data.drafts[0].status, 'pending')
  page.onChooseDevice({ currentTarget: { dataset: { id: 'ble-a' } } })
  state.token = 'user-b'; page.onShow(); state.modal.success({ confirm: true })
  assert.equal(page.data.drafts.length, 0)
  page.onBack()
  assert.equal(state.nav[0].url, '/pages/ai/ai')
})

test('入口蓝色且与九时段标题同排，独立全屏页原生标题和返回，无血糖写入依赖', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(manifest.pages.includes('pages/device-add/device-add'))
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/device-add/device-add.json'), 'utf8'))
  assert.equal(config.navigationBarTitleText, '添加设备')
  const recordTemplate = fs.readFileSync(path.join(root, 'pages/ai/ai.wxml'), 'utf8')
  assert.match(recordTemplate, /record-section-heading[\s\S]*?今日九时段记录[\s\S]*?bindtap="onAddDevice"/)
  const style = fs.readFileSync(path.join(root, 'pages/ai/ai.wxss'), 'utf8')
  assert.match(style, /\.bind-device-link\s*\{[^}]*color:#2878dc/)
  const template = fs.readFileSync(path.join(root, 'pages/device-add/device-add.wxml'), 'utf8')
  for (const text of ['未搜索到附近蓝牙设备', '请确保设备已开机并打开蓝牙', '扫码添加', 'SN 添加', '待适配', '本次登录会话', 'mascot-scene']) assert.ok(template.includes(text), text)
  assert.equal(template.includes('tab-bar'), false)
})
