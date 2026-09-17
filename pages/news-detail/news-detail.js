const { NEWS_LIST } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchNewsDetail, updateNewsAction } = require('../../services/api')

Page({
  data: {
    displayStyle: '',
    news: {},
    liked: false,
    collected: false
  },

  onLoad(options) {
    this._newsId = options.id
    const id = options.id
    const local = NEWS_LIST.find((n) => String(n.id) === String(id)) || NEWS_LIST[0]
    this.setData({ news: local })
    if (local && local.title) {
      wx.setNavigationBarTitle({ title: local.title })
    }
    this.loadDetail(id)
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  loadDetail(id) {
    fetchNewsDetail(id)
      .then((news) => {
        this.setData({
          news,
          liked: !!news.liked,
          collected: !!news.collected
        })
        if (news.title) {
          wx.setNavigationBarTitle({ title: news.title })
        }
      })
      .catch(() => {
        // 保留本地 fallback
      })
  },

  onLike() {
    const next = !this.data.liked
    updateNewsAction(this._newsId || this.data.news.id, { liked: next })
      .then((res) => {
        this.setData({
          liked: res.liked,
          'news.likeCount': res.likeCount
        })
        wx.showToast({ title: res.liked ? '已点赞' : '已取消', icon: 'none' })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
  },

  onCollect() {
    const next = !this.data.collected
    updateNewsAction(this._newsId || this.data.news.id, { collected: next })
      .then((res) => {
        this.setData({
          collected: res.collected,
          'news.collectCount': res.collectCount
        })
        wx.showToast({ title: res.collected ? '已收藏' : '已取消', icon: 'none' })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
  }
})
