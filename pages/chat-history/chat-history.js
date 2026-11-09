const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')
const { SESSION_STATUS, sortSessions, dedupeSessions } = require('../../utils/chat-sessions')

/** 每页条数：列表行只有标题/时间/条数，20 条一屏多一点，翻页成本可控 */
const PAGE_SIZE = 20

/** 筛选条：'' 表示全部（不传 sessionStatus） */
const FILTERS = [
  { key: '', label: '全部' },
  { key: SESSION_STATUS.ACTIVE, label: '进行中' },
  { key: SESSION_STATUS.ENDED, label: '已结束' },
  { key: SESSION_STATUS.ARCHIVED, label: '已归档' }
]

Page({
  data: {
    displayStyle: '',
    filters: FILTERS,
    /** 当前筛选项，与 FILTERS.key 同类型（'' 或数字） */
    filterKey: '',
    list: [],
    pageNum: 1,
    total: 0,
    hasMore: true,
    loading: false,
    /** 首屏加载失败才整页报错；翻页失败只提示，已加载的内容不丢 */
    error: ''
  },

  onShow() {
    applyDisplayToCurrentPage()
    // 每次回到本页都重取第一页：用户在对话页可能刚结束/新建了一个会话
    this.reset()
  },

  reset() {
    this.setData({ list: [], pageNum: 1, total: 0, hasMore: true, error: '' })
    return this.load()
  },

  load() {
    if (this.data.loading || !this.data.hasMore) return Promise.resolve(null)
    const version = (this._loadVersion = (this._loadVersion || 0) + 1)
    this.setData({ loading: true })
    return api
      .fetchChatSessions({
        pageNum: this.data.pageNum,
        pageSize: PAGE_SIZE,
        sessionStatus: this.data.filterKey === '' ? undefined : this.data.filterKey
      })
      .then((page) => {
        if (version !== this._loadVersion) return null
        const merged = dedupeSessions(this.data.list.concat(page.records || []))
        const total = Number(page.total) || merged.length
        this.setData({
          list: sortSessions(merged),
          total,
          pageNum: this.data.pageNum + 1,
          hasMore: merged.length < total,
          loading: false,
          error: ''
        })
        return null
      })
      .catch((err) => {
        if (version !== this._loadVersion) return null
        this.setData({ loading: false, error: (err && err.message) || '历史对话加载失败' })
        return null
      })
  },

  onFilterTap(event) {
    const key = event.currentTarget.dataset.key
    const next = key === undefined || key === null ? '' : key
    if (next === this.data.filterKey) return
    this.setData({ filterKey: next })
    this.reset()
  },

  onPullDownRefresh() {
    this.reset().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.load()
  },

  onRetry() {
    this.reset()
  },

  /** 打开某个历史会话；状态一并带过去，对话页不必等接口就能先渲染只读态 */
  onSessionTap(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    const row = this.data.list.find((item) => item.id === id)
    if (!row) return
    const query = ['from=history', `sessionId=${encodeURIComponent(row.id)}`, `sessionStatus=${encodeURIComponent(row.sessionStatus == null ? '' : row.sessionStatus)}`]
    if (row.title) query.push(`title=${encodeURIComponent(row.title)}`)
    wx.navigateTo({ url: `/pages/voice/voice?${query.join('&')}` })
  },

  onSessionLongPress(event) {
    const id = event.currentTarget.dataset.id
    const row = this.data.list.find((item) => item.id === id)
    if (!row) return
    wx.showActionSheet({
      itemList: [row.isPinned ? '取消置顶' : '置顶', '删除对话'],
      success: (res) => {
        if (res.tapIndex === 0) this.togglePinned(row)
        else if (res.tapIndex === 1) this.confirmRemove(row)
      }
    })
  },

  togglePinned(row) {
    const next = !row.isPinned
    api
      .setChatSessionPinned(row.id, next)
      .then(() => {
        const list = this.data.list.map((item) => (item.id === row.id ? { ...item, isPinned: next } : item))
        this.setData({ list: sortSessions(list) })
        wx.showToast({ title: next ? '已置顶' : '已取消置顶', icon: 'none' })
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' }))
  },

  confirmRemove(row) {
    wx.showModal({
      title: '删除对话',
      content: '删除后不可恢复，确定删除这个对话吗？',
      confirmText: '删除',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return
        api
          .deleteChatSession(row.id)
          .then(() => {
            const list = this.data.list.filter((item) => item.id !== row.id)
            const total = Math.max(this.data.total - 1, list.length)
            this.setData({ list, total, hasMore: list.length < total })
            wx.showToast({ title: '对话已删除', icon: 'none' })
          })
          .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' }))
      }
    })
  }
})
