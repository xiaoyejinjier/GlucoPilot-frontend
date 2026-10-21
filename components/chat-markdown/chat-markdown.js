const { renderChatMarkdown } = require('../../utils/chat-markdown')

Component({
  properties: { content: { type: String, value: '' }, pending: { type: Boolean, value: false } },
  data: { nodes: [] },
  observers: {
    'content, pending'(content, pending) {
      // 旧气泡的内容未变时不重复解析，流式刷新沿用页面原有的节流。
      if (content === this._lastContent && pending === this._lastPending) return
      this._lastContent = content
      this._lastPending = pending
      this.setData({ nodes: renderChatMarkdown(content, pending) })
    }
  }
})
