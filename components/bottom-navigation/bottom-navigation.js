Component({
  properties: {
    unreadCount: { type:Number, value:0 },
    selected: { type: Number, value: 0 },
    brandColor: { type: String, value: '#0969da' },
    guideActive: {
      type: Boolean, value: false,
      observer(active) {
        if (!active) {
          this._guideRunning = false
          this._measureVersion = (this._measureVersion || 0) + 1
          this.setData({ guideReady: false })
          return
        }
        if (!this._guideRunning) {
          this._guideRunning = true
          this._guideFinished = false
          this.setData({ guideIndex: 0, guideReady: false })
        }
        if (this._ready) this.measureGuide()
      }
    }
  },
  data: {
    guideIndex: 0,
    guideReady: false,
    focusStyle: '',
    arrowStyle: '',
    guideSteps: [
      { target: '#nav-item-0', title: '记录', description: '在这里记录血糖、饮食，查看每日记录和统计。' },
      { target: '#nav-item-1', title: '设备管理', description: '以后在这里管理健康设备，功能即将上线。' },
      { target: '#nav-item-2', title: '社区', description: '在这里浏览健康资讯和社区内容。' },
      { target: '#nav-item-3', title: '我的', description: '在这里管理个人资料、健康档案和设置。' },
      { target: '#nav-assistant', title: '小语', description: '和小语打字或语音交流，帮你记录、分析和答疑。' }
    ],
    assistant: { pagePath: '/pages/voice/voice', text: '小语' },
    items: [
      { pagePath: '/pages/ai/ai', text: '记录', icon: 'ai', index: 0 },
      { pagePath: '/pages/devices/devices', text: '设备管理', icon: 'devices', index: 1 },
      { pagePath: '/pages/index/index', text: '社区', icon: 'community', index: 2 },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine', index: 3 }
    ]
  },
  lifetimes: {
    ready() { this._ready = true; if (this.data.guideActive) this.measureGuide() },
    detached() { this._ready = false; this._measureVersion = (this._measureVersion || 0) + 1 }
  },
  pageLifetimes: {
    show() { if (this._ready && this.data.guideActive) this.measureGuide() },
    resize() { if (this._ready && this.data.guideActive) this.measureGuide() }
  },
  methods: {
    measureGuide() {
      const version = (this._measureVersion || 0) + 1
      this._measureVersion = version
      const step = this.data.guideSteps[this.data.guideIndex]
      // 同时测量导航容器，避免使用缓存的屏幕尺寸导致箭头偏移。
      this.createSelectorQuery().select(step.target).boundingClientRect()
        .select('.bottom-navigation').boundingClientRect().exec((rects) => {
          if (version !== this._measureVersion || !this._ready || !this.data.guideActive) return
          const target = rects && rects[0], navigation = rects && rects[1]
          if (!target || !navigation || target.width <= 0 || target.height <= 0) return
          const cardLeft = navigation.width * 20 / 750
          const arrowLeft = target.left + target.width / 2 - navigation.left - cardLeft
          this.setData({
            guideReady: true,
            focusStyle: `left:${target.left}px;top:${target.top}px;width:${target.width}px;height:${target.height}px;`,
            arrowStyle: `left:${arrowLeft}px;`
          })
        })
    },

    nextGuide() {
      if (!this.data.guideActive || !this.data.guideReady) return
      if (this.data.guideIndex === this.data.guideSteps.length - 1) {
        this.finishGuide(false)
        return
      }
      this.setData({ guideIndex: this.data.guideIndex + 1, guideReady: false }, () => this.measureGuide())
    },

    skipGuide() {
      this.finishGuide(true)
    },

    finishGuide(skipped) {
      if (!this.data.guideActive || this._guideFinished) return
      this._guideFinished = true
      this._measureVersion = (this._measureVersion || 0) + 1
      this.setData({ guideReady: false })
      this.triggerEvent('guidecomplete', { skipped })
    },

    stopGuideTouch() {},

    openAssistant() {
      if (this.data.guideActive) return
      if (this._openingAssistant) return
      this._openingAssistant = true
      wx.navigateTo({
        url: this.data.assistant.pagePath,
        complete: () => { this._openingAssistant = false }
      })
    },

    switchTab(e) {
      if (this.data.guideActive) return
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
