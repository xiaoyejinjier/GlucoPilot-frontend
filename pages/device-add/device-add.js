const { applyDisplayToCurrentPage } = require('../../utils/display')
const { getToken } = require('../../utils/request')
const { createDeviceDiscovery } = require('../../services/device-discovery')
const { validateSerial, parseDeviceCode, listDeviceDrafts, addDeviceDraft, removeDeviceDraft } = require('../../utils/device-drafts')

Page({
  data: {
    displayStyle: '', devices: [], drafts: [], searching: false, scanFinished: false, scanError: '',
    qrBusy: false, snVisible: false, snInput: '', nameInput: '', formError: '', formSourceText: 'SN 添加'
  },
  onLoad() {
    this._alive = true
    this._active = false
    this._discovery = createDeviceDiscovery({ api: wx,
      onDevices: (devices) => { if (this.isCurrent()) this.setData({ devices }) },
      onState: (state) => { if (this.isCurrent()) this.setData(state) }
    })
  },
  onShow() {
    this._active = true
    applyDisplayToCurrentPage()
    const token = getToken()
    if (this._token !== token) {
      this._pendingCode = null
      this._qrBusy = false
      this.setData({ devices: [], snVisible: false, snInput: '', nameInput: '', formError: '', scanError: '', qrBusy: false })
    }
    this._token = token
    this.setData({ drafts: listDeviceDrafts(token), searching: false })
    if (this._pendingCode) {
      const pending = this._pendingCode
      this._pendingCode = null
      if (pending.error) this.setData({ scanError: pending.error })
      else this.showSerialForm(pending.item, 'scan')
    }
  },
  onHide() {
    this._active = false
    if (this._discovery) this._discovery.stop()
  },
  onUnload() {
    this._alive = false
    this._active = false
    this._pendingCode = null
    if (this._discovery) this._discovery.stop()
  },
  isCurrent() { return this._alive && this._active && getToken() === this._token },
  ensureSession() {
    if (!this.isCurrent()) return false
    if (this._token) return true
    wx.showToast({ title: '请先登录后再添加设备', icon: 'none' })
    return false
  },
  onSearch() {
    if (!this.ensureSession() || this.data.snVisible || this._qrBusy) return
    if (this.data.searching) { this._discovery.stop(); return }
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    if (info.platform === 'devtools' || typeof wx.onBluetoothDeviceFound !== 'function') {
      this.setData({ scanError: '请在手机微信中搜索蓝牙设备；开发者工具不能代替真机蓝牙测试' })
      return
    }
    return this._discovery.start()
  },
  onOpenSettings() {
    wx.openSetting({ fail: () => {
      if (this.isCurrent()) this.setData({ scanError: '请在微信设置和手机系统设置中检查蓝牙或附近设备权限' })
    } })
  },
  showSerialForm(item = {}, source = 'sn') {
    if (!this.isCurrent()) return
    this._discovery.stop()
    this._formSource = source
    this.setData({ snVisible: true, snInput: item.sn || '', nameInput: item.name || '', formError: '',
      formSourceText: source === 'scan' ? '确认扫码信息' : 'SN 添加' })
  },
  onSnAdd() { if (this.ensureSession()) this.showSerialForm() },
  onCloseSerial() { this.setData({ snVisible: false, snInput: '', nameInput: '', formError: '' }) },
  onFormTap() {},
  onSnInput(e) { this.setData({ snInput: e.detail.value, formError: '' }) },
  onNameInput(e) { this.setData({ nameInput: e.detail.value }) },
  onSaveSerial() {
    if (!this.ensureSession()) return
    try {
      const sn = validateSerial(this.data.snInput)
      const drafts = addDeviceDraft(this._token, { sn, name: this.data.nameInput, source: this._formSource })
      this.setData({ drafts })
      this.onCloseSerial()
      wx.showToast({ title: '已登记，等待型号适配', icon: 'none' })
    } catch (error) { this.setData({ formError: error.message }) }
  },
  onScanAdd() {
    if (!this.ensureSession() || this._qrBusy) return
    this._discovery.stop()
    const token = this._token
    this._qrBusy = true
    this.setData({ qrBusy: true, scanError: '' })
    const accept = (payload) => {
      if (!this._alive || getToken() !== token) return
      // 系统扫码可能使页面先hide后show，回调晚到时仍仅交给同一账号确认。
      if (!this._active) { this._pendingCode = payload; return }
      if (payload.error) this.setData({ scanError: payload.error })
      else this.showSerialForm(payload.item, 'scan')
    }
    try {
      wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode', 'barCode', 'datamatrix'],
        success: (result) => {
          try { accept({ item: parseDeviceCode(result.result) }) } catch (error) { accept({ error: error.message }) }
        },
        fail: (error) => { if (!/cancel/i.test(error.errMsg || '')) accept({ error: '扫码未完成，可重试或使用 SN 添加' }) },
        complete: () => {
          if (this._alive && getToken() === token) {
            this._qrBusy = false
            this.setData({ qrBusy: false })
          }
        }
      })
    } catch (_) {
      this._qrBusy = false
      this.setData({ qrBusy: false, scanError: '当前环境无法扫码，请在手机微信中尝试，或使用 SN 添加' })
    }
  },
  onChooseDevice(e) {
    if (!this.ensureSession()) return
    const device = this.data.devices.find((item) => item.deviceId === e.currentTarget.dataset.id)
    if (!device) return
    const token = this._token
    wx.showModal({ title: '登记候选设备', content: device.name + '\n当前尚未确认型号和通信协议。登记仅加入待适配列表，不会连接设备或读取血糖。',
      confirmText: '登记', success: (result) => {
        if (!result.confirm || !this.isCurrent() || getToken() !== token) return
        try {
          this.setData({ drafts: addDeviceDraft(token, { ...device, source: 'bluetooth' }) })
          wx.showToast({ title: '已登记，等待型号适配', icon: 'none' })
        } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
      }
    })
  },
  onRemoveDraft(e) {
    if (!this.ensureSession()) return
    this.setData({ drafts: removeDeviceDraft(this._token, e.currentTarget.dataset.id) })
  },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/ai/ai' }) }) }
})
