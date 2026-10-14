const { FEEDBACK_TYPES } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { submitFeedback, fetchFeedbacks } = require('../../services/api')

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
    types: FEEDBACK_TYPES,
    activeTypeIndex: 0,
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
    this.resetList(true)
  },

  onTypeTap(e) {
    this.setData({ activeTypeIndex: Number(e.currentTarget.dataset.index) })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onClear() {
    if (this.data.submitting || !this.data.content) return
    this.setData({ content: '' })
  },

  onSubmit() {
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    this.setData({ submitting: true })
    // 端上顺序与后端 feedback_type 1~4 一一对应
    submitFeedback(this.data.activeTypeIndex + 1, content)
      .then(() => {
        this.setData({ submitting: false, content: '' })
        wx.showToast({ title: '已提交', icon: 'success' })
        this.resetList(true)
      })
      .catch((err) => {
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
    this.setData({ loading: true, loadFailed: false })
    return fetchFeedbacks(pageNum, 20)
      .then((page) => {
        if (listVersion !== (this._listVersion || 0)) return
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
        if (listVersion !== (this._listVersion || 0)) return
        this.setData({ loading: false, loadFailed: true })
        if (!silent) {
          wx.showToast({ title: err.message || '反馈加载失败', icon: 'none' })
        }
      })
  },

  onRefreshTap() {
    if (this.data.loading) return
    this.resetList(false)
  },

  onReachBottom() {
    this.loadList(false)
  },

  onPullDownRefresh() {
    this.resetList(true).then(() => wx.stopPullDownRefresh())
  }
})
