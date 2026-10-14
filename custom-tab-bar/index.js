Component({
  data: {
    selected: 0,
    selectedColor: '#07c160',
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
      { pagePath: '/pages/voice/voice', text: '语音', icon: 'voice' },
      { pagePath: '/pages/ai/ai', text: '记录', icon: 'ai' },
      { pagePath: '/pages/stats/stats', text: '统计', icon: 'stats' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine' }
    ]
  },

  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: index })
    }
  }
})
