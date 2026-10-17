const { BANNERS, NEWS_CHANNELS, NEWS_LIST } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchBanners, fetchNews } = require('../../services/api')
const config = require('../../utils/config')
const app = getApp()

Page({
  data: {
    displayStyle: '',
    banners: BANNERS,
    channels: NEWS_CHANNELS,
    activeChannel: '',
    filteredNews: NEWS_LIST,
    loading: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    applyDisplayToCurrentPage()
    if (!app.globalData.isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.loadRemote()
  },

  loadRemote() {
    this.setData({ loading: true })
    Promise.all([
      fetchBanners().catch(() => null),
      fetchNews('', 1, 20).catch(() => null)
    ]).then(([banners, newsPage]) => {
      const patch = { loading: false }
      if (banners && banners.length) {
        patch.banners = banners
      } else if (!config.fallbackLocal) {
        patch.banners = []
      }
      if (newsPage && newsPage.records) {
        patch.filteredNews = newsPage.records
        patch._allNews = newsPage.records
        patch.activeChannel = ''
      } else if (!config.fallbackLocal) {
        patch.filteredNews = []
        patch._allNews = []
      }
      this.setData(patch)
    })
  },

  onChannelTap(e) {
    const channel = e.currentTarget.dataset.channel
    const localAll = this.data._allNews || NEWS_LIST

    if (this.data.activeChannel === channel) {
      this.setData({ activeChannel: '', filteredNews: localAll })
      return
    }

    this.setData({ activeChannel: channel, loading: true })
    fetchNews(channel, 1, 20)
      .then((page) => {
        const list = (page && page.records) || []
        this.setData({
          loading: false,
          filteredNews: list.length ? list : localAll.filter((n) => n.channel === channel)
        })
      })
      .catch(() => {
        const filtered = localAll.filter((n) => n.channel === channel)
        this.setData({
          loading: false,
          filteredNews: filtered.length ? filtered : localAll
        })
      })
  },

  onNewsTap(e) {
    wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${e.currentTarget.dataset.id}` })
  },

  onPullDownRefresh() {
    this.loadRemote()
    setTimeout(() => wx.stopPullDownRefresh(), 500)
  }
})
