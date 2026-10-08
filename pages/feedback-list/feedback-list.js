const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFeedbacks } = require('../../services/api')

Page({
  data: {
    displayStyle: '',
    list: [],
    pageNum: 1,
    total: 0,
    hasMore: true,
    loading: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.reset()
  },

  reset() {
    this.setData({ list: [], pageNum: 1, total: 0, hasMore: true })
    this.load()
  },

  load() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ loading: true })

    fetchFeedbacks(this.data.pageNum, 20)
      .then((page) => {
        const records = page.records || []
        const list = this.data.list.concat(records)
        this.setData({
          list,
          total: page.total || list.length,
          pageNum: this.data.pageNum + 1,
          hasMore: list.length < (page.total || 0),
          loading: false
        })
      })
      .catch((err) => {
        this.setData({ loading: false })
        wx.showToast({ title: err.message || '反馈加载失败', icon: 'none' })
      })
  },

  onReachBottom() {
    this.load()
  },

  onPullDownRefresh() {
    this.reset()
    setTimeout(() => wx.stopPullDownRefresh(), 500)
  }
})
