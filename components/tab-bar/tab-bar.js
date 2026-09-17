const { getTheme, getDisplaySettings } = require('../../utils/display')

Component({
  properties: {
    selected: {
      type: Number,
      value: 2
    }
  },

  data: {
    brandColor: '#07c160',
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
      { pagePath: '/pages/voice/voice', text: '语音', icon: 'voice' },
      { pagePath: '/pages/ai/ai', text: 'AI', icon: 'ai' },
      { pagePath: '/pages/stats/stats', text: '统计', icon: 'stats' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine' }
    ]
  },

  lifetimes: {
    attached() {
      this.refreshBrand()
    }
  },

  pageLifetimes: {
    show() {
      this.refreshBrand()
    }
  },

  methods: {
    refreshBrand() {
      const brand = getTheme(getDisplaySettings().theme).brand
      this.setData({ brandColor: brand })
    },
    switchTab(e) {
      const { path } = e.currentTarget.dataset
      wx.switchTab({ url: path })
    }
  }
})
