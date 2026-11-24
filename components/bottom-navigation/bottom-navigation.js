Component({
  properties: {
    unreadCount: { type:Number, value:0 },
    consultationUnreadCount: { type:Number, value:0 },
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
      { target: '#nav-item-0', title: '记录', description: '记录血糖和饮食、查看健康统计；在“提醒与回复”查看血糖提醒、医生回复和新消息。' },
      { target: '#nav-item-1', title: '问诊', description: '发布求助、按标签筛选，在“问诊消息”与医生交流，在“我的问诊”查看问诊单。' },
      { target: '#nav-item-2', title: '社区', description: '浏览健康文章，选择兴趣标签，参与评论、点赞、收藏，也可与糖友私信交流。' },
      { target: '#nav-item-3', title: '我的', description: '管理资料、健康档案、设备和钱包，查看订单或切换账号；医生可申请提现。' },
      { target: '#nav-assistant', title: '小语', description: '打字或语音提问，查询健康记录与营养信息；长期记忆可在“我的”里查看和删除。' }
    ],
    assistant: { pagePath: '/pages/voice/voice', text: '小语' },
    items: [
      { pagePath: '/pages/ai/ai', text: '记录', icon: 'ai', index: 0 },
      { pagePath: '/pages/consultation/consultation', text: '问诊', icon: 'consultation', index: 1 },
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

    tryAssistant() {
      if (!this.data.guideReady || this.data.guideIndex !== this.data.guideSteps.length - 1) return
      this.finishGuide(false, true)
    },

    finishGuide(skipped, tryAssistant) {
      if (!this.data.guideActive || this._guideFinished) return
      this._guideFinished = true
      this._measureVersion = (this._measureVersion || 0) + 1
      this.setData({ guideReady: false })
      this.triggerEvent('guidecomplete', { skipped, ...(tryAssistant ? { tryAssistant:true } : {}) })
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
