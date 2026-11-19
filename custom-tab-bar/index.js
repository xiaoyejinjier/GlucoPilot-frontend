Component({
  data: {
    selected: 0,
    unreadCount: 0,
    consultationUnread: 0,
    consultationNotice: null,
    guideActive: false,
    selectedColor: '#0969da'
  },

  lifetimes: { attached() { this.refreshGuide() } },
  pageLifetimes: { show() { this.refreshGuide() } },

  methods: {
    refreshGuide() {
      const app = getApp()
      const counts = app.globalData && app.globalData.informationCounts || {}
      this.setData({ unreadCount:Number(app.globalData && app.globalData.unreadCount || 0), consultationUnread:Number(counts.consultations)||0,
        consultationNotice:Array.isArray(counts.consultationConversations) ? counts.consultationConversations[0] || null : null })
      this._guideToken = typeof app.getNavigationGuideToken === 'function' ? app.getNavigationGuideToken() : ''
      this.setData({ guideActive: !!this._guideToken })
    },

    onConsultationNotice() {
      const app = getApp(), notice = this.data.consultationNotice
      if (typeof app.checkLogin === 'function' && !app.checkLogin()) return
      if (notice && /^[1-9]\d{0,18}$/.test(String(notice.consultationId)))
        wx.navigateTo({url:`/pages/consultation-chat/consultation-chat?id=${notice.consultationId}`})
    },

    onGuideComplete(event) {
      const app = getApp()
      const completed = app.completeNavigationGuide(this._guideToken)
      // 其他Tab可能保留了完成前的实例；即使全局已完成，也必须清理旧遮罩。
      this.refreshGuide()
      if (!completed) return
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      if (page && typeof page.onNavigationGuideComplete === 'function') page.onNavigationGuideComplete()
      if (event && event.detail && event.detail.tryAssistant && !this._openingAssistant) {
        this._openingAssistant = true
        wx.navigateTo({url:'/pages/voice/voice',complete:()=>{this._openingAssistant=false}})
      }
    },

    onTabChange(e) {
      this.setData({ selected: e.detail.index })
    }
  }
})
