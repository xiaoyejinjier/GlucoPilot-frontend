const test = require('node:test')
const assert = require('node:assert/strict')
const { createDeviceDiscovery, bluetoothError } = require('../../services/device-discovery')

function fakeApi(overrides = {}) {
  const calls = [], handlers = {}
  const api = {}
  for (const method of ['openBluetoothAdapter', 'startBluetoothDevicesDiscovery', 'stopBluetoothDevicesDiscovery', 'closeBluetoothAdapter']) {
    api[method] = (options) => { calls.push(method); if (overrides[method]) overrides[method](options); else options.success({}) }
  }
  for (const name of ['BluetoothDeviceFound', 'BluetoothAdapterStateChange']) {
    api['on' + name] = (fn) => { handlers[name] = fn }
    api['off' + name] = (fn) => { assert.equal(fn, handlers[name]); delete handlers[name] }
  }
  const lists = [], states = []
  const scanner = createDeviceDiscovery({ api, onDevices: (value) => lists.push(value), onState: (value) => states.push(value) })
  return { scanner, api, calls, handlers, lists, states }
}

test('BLE真实发现按设备标识去重/信号排序，未知名称不假装血糖仪，停止清理监听与适配器', async () => {
  const { scanner, calls, handlers, lists } = fakeApi()
  await scanner.start()
  const found = handlers.BluetoothDeviceFound
  found({ devices: [{ deviceId: 'b', name: '附近设备', RSSI: -90 }, { deviceId: 'a', localName: 'Meter', RSSI: -50 }, { deviceId: 'u', RSSI: 127 }] })
  assert.deepEqual(lists.at(-1).map((item) => item.deviceId), ['a', 'b', 'u'])
  assert.equal(lists.at(-1)[2].name, '未命名蓝牙设备')
  assert.equal(lists.at(-1)[2].signalText, '信号未知')
  found({ devices: [{ deviceId: 'b', name: '附近设备', RSSI: -40 }] })
  assert.equal(lists.at(-1).length, 3)
  assert.equal(lists.at(-1)[0].deviceId, 'b')
  const count = lists.length
  await scanner.stop()
  found({ devices: [{ deviceId: 'late' }] })
  assert.equal(lists.length, count)
  assert.deepEqual(handlers, {})
  assert.deepEqual(calls, ['openBluetoothAdapter', 'startBluetoothDevicesDiscovery', 'stopBluetoothDevicesDiscovery', 'closeBluetoothAdapter'])
})

test('重复搜索不启动第二次扫描；结果上限防止附近广播持续膨胀', async () => {
  const { scanner, calls, handlers, lists } = fakeApi()
  await scanner.start(); await scanner.start()
  handlers.BluetoothDeviceFound({ devices: Array.from({ length: 100 }, (_, i) => ({ deviceId: 'd' + i, RSSI: -50 })) })
  assert.equal(lists.at(-1).length, 30)
  assert.equal(calls.filter((item) => item === 'openBluetoothAdapter').length, 1)
  await scanner.stop()
})

test('初始化未完成即离开，晚回调只释放适配器、不开始搜索', async () => {
  let open
  const { scanner, calls } = fakeApi({ openBluetoothAdapter: (options) => { open = options } })
  const pending = scanner.start()
  await new Promise((resolve) => setImmediate(resolve))
  const cleanup = scanner.stop()
  open.success({}); await pending; await cleanup
  assert.deepEqual(calls, ['openBluetoothAdapter', 'closeBluetoothAdapter'])
})

test('旧扫描晚启动与新搜索串行释放，旧任务不会关闭新适配器', async () => {
  let firstStart, starts = 0
  const { scanner, calls } = fakeApi({ startBluetoothDevicesDiscovery: (options) => {
    starts++; if (starts === 1) firstStart = options; else options.success({})
  } })
  const first = scanner.start()
  await new Promise((resolve) => setImmediate(resolve))
  scanner.stop()
  const second = scanner.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.filter((item) => item === 'openBluetoothAdapter').length, 1)
  firstStart.success({}); await first; await second
  assert.deepEqual(calls.slice(0, 6), ['openBluetoothAdapter', 'startBluetoothDevicesDiscovery', 'stopBluetoothDevicesDiscovery', 'closeBluetoothAdapter', 'openBluetoothAdapter', 'startBluetoothDevicesDiscovery'])
  await scanner.stop()
})

test('蓝牙关闭、授权拒绝和扫描失败有明确提示且停止，失败不返回模拟设备', async () => {
  assert.match(bluetoothError({ errCode: 10001 }), /打开手机蓝牙/)
  assert.match(bluetoothError({ errMsg: 'auth deny' }), /权限/)
  const { scanner, handlers, states } = fakeApi()
  await scanner.start()
  handlers.BluetoothAdapterStateChange({ available: false })
  await scanner.stop()
  assert.ok(states.some((item) => item.scanError && item.scanError.includes('蓝牙不可用')))
  const failed = fakeApi({ startBluetoothDevicesDiscovery: (options) => options.fail({ errCode: 10008 }) })
  await failed.scanner.start(); await failed.scanner.stop()
  assert.equal(failed.lists.at(-1).length, 0)
  assert.ok(failed.states.some((item) => item.scanError))
  assert.equal(failed.calls.at(-1), 'closeBluetoothAdapter')
})

test('达到搜索时长自动停止，不永久占用手机蓝牙', async () => {
  const fixture = fakeApi()
  const scanner = createDeviceDiscovery({ api: fixture.api, duration: 5, onDevices() {}, onState() {} })
  await scanner.start()
  await new Promise((resolve) => setTimeout(resolve, 25))
  await scanner.stop()
  assert.ok(fixture.calls.includes('stopBluetoothDevicesDiscovery'))
  assert.ok(fixture.calls.includes('closeBluetoothAdapter'))
})
