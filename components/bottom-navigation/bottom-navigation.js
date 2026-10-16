Component({
  properties: {
    selected: { type: Number, value: 0 },
    brandColor: { type: String, value: '#07c160' }
  },
  data: {
    assistant: { pagePath: '/pages/voice/voice', text: '小语' },
    items: [
      { pagePath: '/pages/ai/ai', text: '记录', icon: 'ai', index: 0 },
      { pagePath: '/pages/devices/devices', text: '设备管理', icon: 'devices', index: 1 },
      { pagePath: '/pages/index/index', text: '社区', icon: 'community', index: 2 },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine', index: 3 }
    ]
  },
  methods: {
    openAssistant() {
      if (this._openingAssistant) return
      this._openingAssistant = true
      wx.navigateTo({
        url: this.data.assistant.pagePath,
        complete: () => { this._openingAssistant = false }
      })
    },

    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      const destination = this.data.items
        .find((item) => item.pagePath === path && item.index === Number(index))
      if (!destination) return
      wx.switchTab({
        url: destination.pagePath,
        success: () => {
          this.setData({ selected: destination.index })
          this.triggerEvent('tabchange', { index: destination.index })
        }
      })
    }
  }
})
