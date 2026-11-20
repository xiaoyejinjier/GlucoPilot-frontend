const { applyDisplayToCurrentPage } = require('../../utils/display')
const { submitFeedback, fetchFeedbacks, fetchFeedbackTypes, fetchMyDevices } = require('../../services/api')
const { getToken } = require('../../utils/request')

function sortLatestFirst(list) {
  return list.slice().sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime() || 0
    const bTime = new Date(b.createdAt || 0).getTime() || 0
    if (aTime !== bTime) return bTime - aTime
    return Number(b.id || 0) - Number(a.id || 0)
  })
}

function mergeFeedbacks(current, incoming) {
  const seen = {}
  return sortLatestFirst(current.concat(incoming).filter((item) => {
    const key = String(item.id)
    if (seen[key]) return false
    seen[key] = true
    return true
  }))
}

Page({
  data: {
    displayStyle: '',
    types: [],
    typesLoading: true,
    typesError: false,
    activeTypeIndex: 0,
    deviceRelated: false,
    devices: [],
    deviceLabels: [],
    deviceIndex: 0,
    deviceDescription: '',
    devicesError: false,
    content: '',
    submitting: false,
    list: [],
    pageNum: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadFailed: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    const token = getToken()
    if (this._token !== token) {
      this.setData({ content: '', activeTypeIndex: 0, types: [], deviceRelated: false,
        devices: [], deviceLabels: [], deviceIndex: 0, deviceDescription: '', submitting: false })
    }
    this._token = token
    this._disposed = false
    this.loadOptions()
    this.resetList(true)
  },

  onUnload() {
    this._disposed = true
    this._listVersion = (this._listVersion || 0) + 1
  },

  current(token) {
    return !this._disposed && !!token && token === getToken() && token === this._token
  },

  loadOptions() {
    const token = this._token
    const run = this._optionsRun = (this._optionsRun || 0) + 1
    const current = () => this.current(token) && run === this._optionsRun
    this.setData({ typesLoading: true, typesError: false, devicesError: false })
    const types = fetchFeedbackTypes().then((rows) => {
      if (!current()) return
      const previous = this.data.types[this.data.activeTypeIndex]
      const activeTypeIndex = Math.max(0, rows.findIndex(t => previous && t.id === previous.id))
      this.setData({ types: rows, activeTypeIndex, typesLoading: false,
        deviceRelated: !!(rows[activeTypeIndex] && rows[activeTypeIndex].deviceRelated) })
    }).catch(() => {
      if (current()) this.setData({ typesLoading: false, typesError: true })
    })
    const devices = fetchMyDevices().then((rows) => {
      if (!current()) return
      const selected = this.data.devices[this.data.deviceIndex - 1]
      const deviceIndex = selected ? rows.findIndex(d => String(d.id) === String(selected.id)) + 1 : 0
      this.setData({ devices: rows, deviceIndex,
        deviceLabels: ['未绑定或其他设备'].concat(rows.map(d => d.deviceName)) })
    }).catch(() => {
      if (current()) this.setData({ devices: [], deviceIndex: 0,
        deviceLabels: ['未绑定或其他设备'], devicesError: true })
    })
    return Promise.all([types, devices])
  },

  onTypeTap(e) {
    if (this.data.submitting) return
    const activeTypeIndex = Number(e.currentTarget.dataset.index)
    const type = this.data.types[activeTypeIndex]
    if (type) this.setData({ activeTypeIndex, deviceRelated: !!type.deviceRelated })
  },

  onDeviceChange(e) {
    if (!this.data.submitting) this.setData({ deviceIndex: Number(e.detail.value) })
  },

  onDeviceInput(e) {
    if (!this.data.submitting) this.setData({ deviceDescription: e.detail.value })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onClear() {
    if (this.data.submitting || !this.data.content) return
    this.setData({ content: '' })
  },

  onSubmit() {
    const token = this._token
    if (!this.current(token) || this.data.submitting) return
    const type = this.data.types[this.data.activeTypeIndex]
    if (!type || this.data.typesLoading || this.data.typesError) {
      wx.showToast({ title: '请先加载反馈类型', icon: 'none' })
      return
    }
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    let device
    if (type.deviceRelated) {
      const selected = this.data.devices[this.data.deviceIndex - 1]
      const deviceDescription = this.data.deviceDescription.trim()
      if (!selected && !deviceDescription) {
        wx.showToast({ title: '请选择设备或填写设备品牌型号', icon: 'none' })
        return
      }
      device = { deviceId: selected && selected.id, deviceDescription }
    }

    this.setData({ submitting: true })
    // 使用类型表的实际ID，不能根据排序下标推算类型编号。
    return submitFeedback(type.id, content, device)
      .then(() => {
        if (!this.current(token)) return
        this.setData({ submitting: false, content: '', deviceDescription: '', deviceIndex: 0 })
        wx.showToast({ title: '已提交', icon: 'success' })
        this.resetList(true)
      })
      .catch((err) => {
        if (!this.current(token)) return
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || '提交失败', icon: 'none' })
      })
  },

  resetList(silent) {
    this._listVersion = (this._listVersion || 0) + 1
    this.setData({
      list: [],
      pageNum: 1,
      total: 0,
      hasMore: true,
      loadFailed: false
    })
    return this.loadList(!!silent, true)
  },

  loadList(silent, force) {
    if ((!force && this.data.loading) || !this.data.hasMore) return Promise.resolve()

    const pageNum = this.data.pageNum
    const listVersion = this._listVersion || 0
    const token = this._token
    this.setData({ loading: true, loadFailed: false })
    return fetchFeedbacks(pageNum, 20)
      .then((page) => {
        if (!this.current(token) || listVersion !== (this._listVersion || 0)) return
        const records = (page && page.records) || []
        const base = pageNum === 1 ? [] : this.data.list
        const list = mergeFeedbacks(base, records)
        const total = Number(page && page.total) || list.length
        this.setData({
          list,
          total,
          pageNum: pageNum + 1,
          hasMore: records.length > 0 && list.length < total,
          loading: false,
          loadFailed: false
        })
      })
      .catch((err) => {
        if (!this.current(token) || listVersion !== (this._listVersion || 0)) return
        this.setData({ loading: false, loadFailed: true })
        if (!silent) {
          wx.showToast({ title: err.message || '反馈加载失败', icon: 'none' })
        }
      })
  },

  onRefreshTap() {
    if (this.data.loading) return
    return Promise.all([this.loadOptions(), this.resetList(false)])
  },

  onReachBottom() {
    this.loadList(false)
  },

  onPullDownRefresh() {
    return Promise.all([this.loadOptions(), this.resetList(true)]).then(() => wx.stopPullDownRefresh())
  }
})
