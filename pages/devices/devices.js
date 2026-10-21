const { applyDisplayToCurrentPage } = require('../../utils/display')
const {
  listDeviceDrafts,
  removeDeviceDraft,
  updateDeviceDraftSn,
  validateSerial
} = require('../../utils/device-drafts')
const { fetchMyDevices, bindDevice, unbindDevice, syncMockGlucose } = require('../../services/api')
const { getToken } = require('../../utils/request')
const app = getApp()

const PROVIDERS = ['MOCK', 'HUAWEI', 'HEALTH_CONNECT', 'APPLE_HEALTH', 'NIGHTSCOUT']
const OFFLINE_MS = 48 * 60 * 60 * 1000

function parseTime(value) {
  if (!value) return null
  const t = Date.parse(String(value).replace(' ', 'T'))
  return Number.isNaN(t) ? null : t
}

function formatSyncText(lastSyncAt, online) {
  if (!lastSyncAt) return online ? '尚未同步 · 可先尝试 MOCK 同步' : '尚未同步 · 可稍后重试'
  const s = String(lastSyncAt).replace('T', ' ')
  const short = s.length > 16 ? s.slice(0, 16) : s
  return online ? `最近同步：${short} · 来源设备读数` : `最近同步：${short} · 可稍后重试`
}

function enrichDevice(d) {
  const ts = parseTime(d.lastSyncAt)
  const online = d.deviceStatus === 1 && ts != null && (Date.now() - ts) <= OFFLINE_MS
  const lastSyncDisplay = d.lastSyncAt
    ? String(d.lastSyncAt).replace('T', ' ').slice(0, 19)
    : '暂无'
  return Object.assign({}, d, {
    online,
    statusText: online ? '已绑定' : '已离线',
    syncActionText: online ? '同步记录' : '重新同步',
    syncText: formatSyncText(d.lastSyncAt, online),
    lastSyncDisplay
  })
}

function computeLastSyncLabel(devices) {
  let newest = null
  for (const d of devices) {
    const ts = parseTime(d.lastSyncAt)
    if (ts != null && (newest == null || ts > newest)) newest = ts
  }
  if (newest == null) return '—'
  const diff = Date.now() - newest
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分`
  if (diff < 48 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h`
  return `${Math.floor(diff / 86400000)}天`
}

Page({
  data: {
    displayStyle: '',
    loading: false,
    boundDevices: [],
    boundCount: 0,
    drafts: [],
    lastSyncLabel: '—',
    providers: PROVIDERS,
    detailVisible: false,
    detail: {},
    snVisible: false,
    snDraftId: '',
    snInput: '',
    snError: '',
    bindVisible: false,
    bindDraft: {},
    bindProvider: 'MOCK',
    bindName: '',
    binding: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    applyDisplayToCurrentPage()
    if (!app.globalData.isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.refresh()
  },

  applyList(boundDevices, drafts) {
    this.setData({
      loading: false,
      boundDevices,
      boundCount: boundDevices.length,
      drafts,
      lastSyncLabel: computeLastSyncLabel(boundDevices)
    })
  },

  refresh() {
    const token = getToken()
    const drafts = listDeviceDrafts(token)
    this.setData({ loading: true, drafts })
    fetchMyDevices()
      .then((list) => {
        this.applyList((list || []).map(enrichDevice), listDeviceDrafts(token))
      })
      .catch((err) => {
        this.applyList([], listDeviceDrafts(token))
        wx.showToast({ title: (err && err.message) || '加载设备失败', icon: 'none' })
      })
  },

  onAddDevice() {
    wx.navigateTo({ url: '/pages/device-add/device-add' })
  },

  onSync(e) {
    const id = e.currentTarget.dataset.id
    const device = this.data.boundDevices.find((item) => item.id === String(id))
    if (!device) return
    if (device.provider !== 'MOCK') {
      wx.showToast({ title: '该厂商协议未接入，暂无真实读数', icon: 'none' })
      return
    }
    wx.showLoading({ title: '同步中', mask: true })
    syncMockGlucose(undefined, device.deviceSn)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '同步完成', icon: 'success' })
        this.refresh()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '同步失败', icon: 'none' })
      })
  },

  onDetail(e) {
    const id = e.currentTarget.dataset.id
    const device = this.data.boundDevices.find((item) => item.id === String(id))
    if (!device) return
    this.setData({ detailVisible: true, detail: device })
  },

  onCloseDetail() {
    this.setData({ detailVisible: false })
  },

  onUnbind(e) {
    const id = e.currentTarget.dataset.id
    const device = this.data.boundDevices.find((item) => item.id === String(id))
    if (!device) return
    wx.showModal({
      title: '解绑设备',
      content: `确定解绑「${device.deviceName}」？解绑后保留档案，可再次绑定同一 SN。`,
      success: (res) => {
        if (!res.confirm) return
        unbindDevice(device.id)
          .then(() => {
            wx.showToast({ title: '已解绑', icon: 'success' })
            this.refresh()
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '解绑失败', icon: 'none' })
          })
      }
    })
  },

  onRemoveDraft(e) {
    const id = e.currentTarget.dataset.id
    const drafts = removeDeviceDraft(getToken(), id)
    this.applyList(this.data.boundDevices, drafts)
  },

  onSupplementSn(e) {
    const id = e.currentTarget.dataset.id
    const draft = this.data.drafts.find((item) => item.id === id)
    if (!draft) return
    this.setData({
      snVisible: true,
      snDraftId: id,
      snInput: draft.sn || '',
      snError: ''
    })
  },

  onCloseSn() {
    this.setData({ snVisible: false, snDraftId: '', snInput: '', snError: '' })
  },

  onSnInput(e) {
    this.setData({ snInput: e.detail.value, snError: '' })
  },

  onSaveSn() {
    try {
      validateSerial(this.data.snInput)
      const drafts = updateDeviceDraftSn(getToken(), this.data.snDraftId, this.data.snInput)
      this.setData({ snVisible: false, snDraftId: '', snInput: '', snError: '' })
      this.applyList(this.data.boundDevices, drafts)
      wx.showToast({ title: '已补充 SN', icon: 'success' })
    } catch (err) {
      this.setData({ snError: (err && err.message) || 'SN 无效' })
    }
  },

  onConfirmBind(e) {
    const id = e.currentTarget.dataset.id
    const draft = this.data.drafts.find((item) => item.id === id)
    if (!draft || !draft.sn) {
      wx.showToast({ title: '请先补充 SN', icon: 'none' })
      return
    }
    this.setData({
      bindVisible: true,
      bindDraft: draft,
      bindProvider: 'MOCK',
      bindName: draft.name || ''
    })
  },

  onCloseBind() {
    this.setData({ bindVisible: false, binding: false })
  },

  onBindNameInput(e) {
    this.setData({ bindName: e.detail.value })
  },

  onPickProvider(e) {
    this.setData({ bindProvider: e.currentTarget.dataset.provider })
  },

  onSubmitBind() {
    const draft = this.data.bindDraft
    if (!draft || !draft.sn || this.data.binding) return
    this.setData({ binding: true })
    bindDevice({
      deviceSn: draft.sn,
      provider: this.data.bindProvider,
      deviceName: this.data.bindName
    })
      .then(() => {
        removeDeviceDraft(getToken(), draft.id)
        this.setData({
          binding: false,
          bindVisible: false,
          drafts: listDeviceDrafts(getToken())
        })
        wx.showToast({ title: '绑定成功', icon: 'success' })
        this.refresh()
      })
      .catch((err) => {
        this.setData({ binding: false })
        wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' })
      })
  },

  noop() {},

  onPullDownRefresh() {
    this.refresh()
    setTimeout(() => wx.stopPullDownRefresh(), 400)
  }
})
