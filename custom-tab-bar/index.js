Component({
  data: {
    selected: 0,
    unreadCount: 0,
    guideActive: false,
    selectedColor: '#07c160'
  },

  lifetimes: { attached() { this.refreshGuide() } },
  pageLifetimes: { show() { this.refreshGuide() } },

  methods: {
    refreshGuide() {
      const app = getApp()
      this.setData({ unreadCount:Number(app.globalData && app.globalData.unreadCount || 0) })
      this._guideToken = typeof app.getNavigationGuideToken === 'function' ? app.getNavigationGuideToken() : ''
      this.setData({ guideActive: !!this._guideToken })
    },

    onGuideComplete() {
      const app = getApp()
      const completed = app.completeNavigationGuide(this._guideToken)
      // 其他Tab可能保留了完成前的实例；即使全局已完成，也必须清理旧遮罩。
      this.refreshGuide()
      if (!completed) return
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (page && typeof page.onNavigationGuideComplete === 'function') page.onNavigationGuideComplete()
    },

    onTabChange(e) {
      this.setData({ selected: e.detail.index })
    }
  }
})
