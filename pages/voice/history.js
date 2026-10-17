const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchChatSessions, deleteChatSession, setChatSessionPinned } = require('../../services/api')
const { HISTORY_PAGE_SIZE, sortSessions, dedupeSessions } = require('../../utils/chat-sessions')
const app = getApp()

/** 每页条数：后端默认 20、上限 50，取 20 与后端默认一致 */
const PAGE_SIZE = HISTORY_PAGE_SIZE

Page({
  data: {
    displayStyle: '',
    list: [],
    pageNum: 1,
    /** total 是后端 Long 序列化出来的字符串，只用于展示，不参与运算 */
    total: '0',
    hasMore: true,
    loading: false,
    /** 第一页是否已经有结果：避免加载中就先闪一下"还没有对话记录" */
    loaded: false,
    archiveIdleDays: 0
  },

  onShow() {
    applyDisplayToCurrentPage()
    // 每次进入都重拉第一页：排序受"置顶 + 最近消息时间"影响，
    // 沿用上次的数据会让人以为刚才的置顶/删除没生效。
    // 返回 promise 只为让调用方（含测试）能等到这一轮加载结束，小程序本身不关心返回值。
    return this.reset()
  },

  reset() {
    this.setData({ list: [], pageNum: 1, total: '0', hasMore: true, loading: false, loaded: false })
    return this.load()
  },

  load() {
    if (this.data.loading || !this.data.hasMore) return Promise.resolve(null)
    this.setData({ loading: true })
    const pageNum = this.data.pageNum
    return fetchChatSessions({ pageNum, pageSize: PAGE_SIZE })
      .then((page) => {
        // 翻页期间若有新会话写入，同一条可能出现在两页里，按 id（字符串）去重
        const merged = dedupeSessions(this.data.list.concat(page.records))
        this.setData({
          list: sortSessions(merged),
          total: page.total,
          archiveIdleDays: page.archiveIdleDays,
          pageNum: pageNum + 1,
          // "还有下一页"按"这一页是否取满"判断，不去算字符串 total
          hasMore: page.records.length >= PAGE_SIZE,
          loading: false,
          loaded: true
        })
        return merged
      })
      .catch((err) => {
        this.setData({ loading: false, loaded: true })
        wx.showToast({ title: (err && err.message) || '对话列表加载失败，请稍后重试', icon: 'none' })
        return null
      })
  },

  onReachBottom() {
    return this.load()
  },

  onPullDownRefresh() {
    return this.reset().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    )
  },

  /** 点一条会话：通过一次性意图在独立的小语页面打开，保留返回路径。 */
  onTapSession(e) {
    const { id, status, title } = e.currentTarget.dataset
    if (!id) return
    if (app.globalData) app.globalData.pendingChatSession = { id, sessionStatus: status, title }
    wx.navigateTo({ url: '/pages/voice/voice' })
  },

  /** 空态里的「开始新对话」：让对话页直接走新建，而不是回到上次那条会话。 */
  onStartNewChat() {
    if (app.globalData) app.globalData.pendingNewChat = true
    wx.navigateTo({ url: '/pages/voice/voice' })
  },

  /** 长按（或点「···」）弹出会话操作：置顶/取消置顶、删除 */
  onLongPress(e) {
    this.openActions(e.currentTarget.dataset)
  },

  onMore(e) {
    this.openActions(e.currentTarget.dataset)
  },

  openActions(dataset) {
    const id = dataset.id
    if (!id) return
    const pinned = dataset.pinned === true || dataset.pinned === 'true'
    wx.showActionSheet({
      itemList: [pinned ? '取消置顶' : '置顶', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.togglePinned(id, !pinned)
        else if (res.tapIndex === 1) this.confirmDelete(id)
      },
      fail: () => {}
    })
  },

  togglePinned(id, nextPinned) {
    return setChatSessionPinned(id, nextPinned)
      .then(() => {
        // 本地先按"置顶优先"重排，避免为一次置顶重拉整个列表
        const list = this.data.list.map((item) => (
          item.id === id ? { ...item, isPinned: nextPinned } : item
        ))
        this.setData({ list: sortSessions(list) })
        wx.showToast({ title: nextPinned ? '已置顶' : '已取消置顶', icon: 'none' })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '操作失败，请稍后重试', icon: 'none' })
      })
  },

  confirmDelete(id) {
    wx.showModal({
      title: '删除对话',
      content: '删除后这段对话记录将不可恢复',
      confirmText: '删除',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return
        this.remove(id)
      }
    })
  },

  remove(id) {
    return deleteChatSession(id)
      .then(() => {
        this.setData({ list: this.data.list.filter((item) => item.id !== id) })
        // 若被删的正好是对话页当前打开的会话，通知它回到"没有会话"状态
        if (app.globalData) app.globalData.chatSessionEvent = { type: 'deleted', id }
        wx.showToast({ title: '已删除', icon: 'none' })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '删除失败，请稍后重试', icon: 'none' })
      })
  }
})
