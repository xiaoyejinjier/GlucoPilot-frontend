/** 仅发现附近BLE设备，不连接、不读特征、不猜测厂商协议。 */
function bluetoothError(error) {
  const code = Number(error && error.errCode)
  const text = error && error.errMsg || ''
  if (/auth|permission|authorize|deny/i.test(text) || code === 103) {
    return '蓝牙权限未开启，请在微信和系统设置中允许蓝牙或附近设备权限'
  }
  if (code === 10001) return '蓝牙不可用，请打开手机蓝牙，并检查微信的系统蓝牙权限'
  if (code === 10009) return '当前手机系统暂不支持低功耗蓝牙搜索'
  return '暂时无法搜索蓝牙，请确认设备已开机、系统蓝牙和相关权限已开启后重试'
}

function createDeviceDiscovery({ api, onDevices, onState, duration = 12000 }) {
  let session = null
  let cleanup = Promise.resolve()
  const call = (method, options = {}) => new Promise((resolve, reject) => {
    if (typeof api[method] !== 'function') { reject(new Error('当前环境不支持蓝牙')); return }
    try { api[method]({ ...options, success: resolve, fail: reject }) } catch (error) { reject(error) }
  })
  const release = async (run) => {
    if (run.started) await call('stopBluetoothDevicesDiscovery').catch(() => null)
    if (run.opened) await call('closeBluetoothAdapter').catch(() => null)
  }
  function stop() {
    const run = session
    if (!run || !run.active) return cleanup
    run.active = false
    if (run.timer) clearTimeout(run.timer)
    if (run.found && typeof api.offBluetoothDeviceFound === 'function') api.offBluetoothDeviceFound(run.found)
    if (run.state && typeof api.offBluetoothAdapterStateChange === 'function') api.offBluetoothAdapterStateChange(run.state)
    onState({ searching: false, scanFinished: true })
    // 等待初始化/启动回调再释放；新搜索先等旧释放完成，避免旧任务关闭新适配器。
    cleanup = run.task.then(() => release(run), () => release(run))
    return cleanup
  }
  function start() {
    if (session && session.active) return session.task
    const before = cleanup
    const run = { active: true, opened: false, started: false, devices: new Map() }
    session = run
    onDevices([])
    onState({ searching: true, scanError: '', scanFinished: false })
    run.task = Promise.resolve().then(async () => {
      await before
      if (!run.active) return
      await call('openBluetoothAdapter', { mode: 'central' })
      run.opened = true
      if (!run.active) return
      run.found = (event) => {
        if (!run.active || session !== run) return
        for (const item of event && Array.isArray(event.devices) ? event.devices : []) {
          if (!item || typeof item.deviceId !== 'string' || !item.deviceId.trim()) continue
          if (!run.devices.has(item.deviceId) && run.devices.size >= 40) continue
          const rssi = typeof item.RSSI === 'number' && item.RSSI < 0 && item.RSSI > -127 ? item.RSSI : -999
          const name = typeof item.name === 'string' && item.name.trim() ? item.name : item.localName
          run.devices.set(item.deviceId, { deviceId: item.deviceId, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : '未命名蓝牙设备',
            rssi, signalText: rssi === -999 ? '信号未知' : rssi >= -60 ? '信号强' : rssi >= -80 ? '信号一般' : '信号较弱' })
        }
        onDevices(Array.from(run.devices.values()).sort((a, b) => b.rssi - a.rssi).slice(0, 30))
      }
      run.state = (event) => {
        if (!run.active || session !== run) return
        if (!event.available) { onState({ scanError: bluetoothError({ errCode: 10001 }) }); stop() }
        else if (event.discovering === false && run.started) stop()
      }
      api.onBluetoothDeviceFound(run.found)
      if (typeof api.onBluetoothAdapterStateChange === 'function') api.onBluetoothAdapterStateChange(run.state)
      await call('startBluetoothDevicesDiscovery', { allowDuplicatesKey: false, powerLevel: 'medium' })
      run.started = true
      if (run.active) run.timer = setTimeout(() => { if (session === run && run.active) stop() }, duration)
    }).catch((error) => {
      if (run.active && session === run) { onState({ scanError: bluetoothError(error) }); stop() }
    })
    return run.task
  }
  return { start, stop }
}

module.exports = { createDeviceDiscovery, bluetoothError }
