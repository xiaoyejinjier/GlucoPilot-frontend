const api = require('../../services/consultation')
const social = require('../../utils/community')
const notifications = require('../../utils/message-notifications')
const { identifier } = require('../../utils/consultation')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: {
    displayStyle: '', item: null, messages: [], input: '', ready: false,
    loading: false, sending: false, canSend: false, hasMore: false,
    error: '', readError: '', scrollTarget: '', newMessages: false,
    viewportHeight: 0, keyboardHeight: 0, keyboardOffset: 0, composerHeight: 0
  },
  onLoad(options) { this._id = identifier(options.id); this._token = getToken() },
  onReady() { this.measureLayout() },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage()
    this.stopPolling(); this._busy = false; this._atBottom = true
    this._run = (this._run || 0) + 1
    if (this._token !== getToken()) {
      this._attempt = null
      this.setData({ item: null, messages: [], input: '', ready: false, canSend: false, error: '请重新打开问诊记录' })
      return
    }
    this.attachKeyboard()
    this.load()
  },
  onHide() {
    social.end(this); this.stopPolling(); this._run = (this._run || 0) + 1; this._busy = false
    if (this._keyboardHandler && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(this._keyboardHandler)
    this._keyboardHandler = null
    this._focused = false
    this.setData({ keyboardHeight: 0, keyboardOffset: 0 })
  },
  onUnload() { this.onHide() },
  current(version, run) { return social.active(this, version) && run === this._run },
  stopPolling() { if (this._timer) clearInterval(this._timer); this._timer = null },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.stopPolling(); this._busy = false; this._readThrough = ''; this._afterId = ''
    this.setData({ loading: true, ready: false, canSend: false, sending: false, error: '', readError: '', messages: [] })
    if (!this._id) { this.setData({ loading: false, error: '问诊记录不存在或尚未发布' }); return }
    try {
      const item = await api.detail(this._id)
      if (!this.current(version, run)) return
      if (!item.detailsVisible || !['IN_PROGRESS', 'REPORT_READY', 'CLOSED'].includes(item.status)) throw new Error('问诊尚未接诊或无权交流')
      this.setData({ item, ready: true }, () => this.measureLayout())
      await this.loadMessages()
      if (this.current(version, run)) this._timer = setInterval(() => this.loadMessages('after'), 5000)
    } catch (error) {
      if (this.current(version, run)) { this.setData({ loading: false, error: error.message || '交流记录加载失败，请重试' }); social.failure(this, error, version) }
    }
  },
  merge(rows) {
    const messages = social.mergeMessages(this.data.messages, rows)
    // 以完整日期和分钟分组；发送、轮询及加载历史后统一重算分界。
    return messages.map((message, index) => ({
      ...message,
      showTime: !!message.timeLabel && (index === 0 || message.timeLabel !== messages[index - 1].timeLabel)
    }))
  },
  async loadMessages(direction) {
    if (!social.active(this) || !this.data.ready || this._busy) return
    this._busy = true
    const version = this._communityVersion, run = this._run
    const first = this.data.messages[0]
    if (direction !== 'after') this.setData({ loading: true })
    try {
      let more
      do {
        const rows = this.data.messages
        const params = { pageSize: 30 }
        if (direction === 'after' && this._afterId) params.afterId = this._afterId
        if (direction === 'before' && rows.length) params.beforeId = rows[0].id
        const page = await api.messages(this._id, params)
        if (!this.current(version, run)) return
        const fresh = page.records || [], messages = this.merge(fresh)
        if (direction !== 'before' && fresh.length) this._afterId = fresh[fresh.length - 1].id
        const added = messages.length > rows.length
        const scroll = direction !== 'before' && (!direction || this._atBottom)
        this.setData({ messages, canSend: page.canSend === true, error: '',
          ...(direction !== 'after' ? { hasMore: page.hasMore === true } : {}),
          ...(scroll ? { scrollTarget: '', newMessages: false } : added && direction === 'after' ? { newMessages: true } : {})
        }, () => {
          if (!this.current(version, run)) return
          this.measureLayout()
          if (direction === 'before' && first) this.setData({ scrollTarget: `consult-msg-${first.id}` })
          else if (scroll) this.scrollToBottom()
          const incoming = messages.filter(row => !row.mine).at(-1)
          if (incoming) this.markRead(incoming.id, version, run)
        })
        more = direction === 'after' && page.hasMore && fresh.length > 0
      } while (more && this.current(version, run))
    } catch (error) {
      if (this.current(version, run)) {
        this.setData({ error: error.message || '交流记录加载失败，请重试' })
        if (error.code === 40100) social.failure(this, error, version)
      }
    } finally {
      if (this.current(version, run)) { this._busy = false; this.setData({ loading: false }) }
    }
  },
  async markRead(through, version, run) {
    if (!this.current(version, run) || this._readThrough === String(through)) return
    try {
      await api.readMessages(this._id, String(through))
      if (!this.current(version, run)) return
      if (!this._readThrough || social.compareId({ id: through }, { id: this._readThrough }) > 0) this._readThrough = String(through)
      this.setData({ readError: '' }); notifications.refresh(true)
    } catch (error) {
      if (this.current(version, run)) this.setData({ readError: '已读状态更新失败，稍后重试' })
    }
  },
  onOlder() { if (this.data.hasMore) return this.loadMessages('before') },
  onRetry() { return this.data.ready ? this.loadMessages('after') : this.load() },
  onInput(event) { if (!this.data.sending) { this._attempt = null; this.setData({ input: event.detail.value }) } },
  async onSend() {
    const content = this.data.input.trim()
    if (!social.active(this) || !this.data.ready || !this.data.canSend || this.data.sending || !content) return
    if (content.length > 2000) { wx.showToast({ title: '消息最多2000字', icon: 'none' }); return }
    const version = this._communityVersion, run = this._run
    if (!this._attempt || this._attempt.content !== content) this._attempt = { content, clientRequestId: social.requestId() }
    this.setData({ sending: true })
    try {
      const saved = await api.sendMessage(this._id, this._attempt)
      if (!this.current(version, run)) return
      this._attempt = null; this._atBottom = true
      this.setData({ messages: this.merge([saved]), input: '', error: '' }, () => this.scrollToBottom())
      // 先补齐所有未拉取的对方消息，不能用自己刚发的ID跨过它们。
      this.loadMessages('after')
    } catch (error) {
      if (this.current(version, run)) { this.setData({ error: error.message || '回复发送失败，请重试' }); if (error.code === 40100) social.failure(this, error, version) }
    } finally { if (this.current(version, run)) this.setData({ sending: false }) }
  },
  scrollToBottom() {
    if (!social.active(this) || !this.data.messages.length) return
    this._atBottom = true
    this.setData({ scrollTarget: `consult-msg-${this.data.messages.at(-1).id}`, newMessages: false })
  },
  onScroll(event) {
    const detail = event.detail
    if (this._listHeight) this._atBottom = detail.scrollHeight - detail.scrollTop - this._listHeight < 40
  },
  onLower() { this._atBottom = true; this.setData({ newMessages: false }) },
  onUpper() { this._atBottom = false },
  onDetails() { if (social.active(this)) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${this._id}` }) },
  attachKeyboard() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      if (Number.isFinite(info.windowHeight) && info.windowHeight > 0) {
        this._fullHeight = this._windowHeight = info.windowHeight
        this.updateViewport(0)
      }
    } catch (_) { /* 获取窗口尺寸失败时仍显示输入栏并继续加载会话。 */ }
    if (wx.onKeyboardHeightChange && wx.offKeyboardHeightChange) {
      const version = this._communityVersion
      this._keyboardHandler = event => { if (social.active(this, version)) this.updateViewport(Math.max(0, Number(event.height) || 0)) }
      wx.onKeyboardHeightChange(this._keyboardHandler)
    }
  },
  onResize(event) {
    const height = Number(event.size && event.size.windowHeight)
    if (!social.active(this) || !Number.isFinite(height) || height < 1) return
    this._windowHeight = height
    if (!this.data.keyboardHeight && !this._focused) this._fullHeight = height
    this.updateViewport(this.data.keyboardHeight)
  },
  updateViewport(height) {
    if (!social.active(this) || !this._fullHeight) return
    const viewportHeight = Math.max(1, Math.min(this._windowHeight, this._fullHeight - height))
    // iOS需要抬起页面底边，Android已缩小窗口时不再重复抬升。
    const keyboardOffset = Math.max(0, this._windowHeight - viewportHeight)
    const version = this._communityVersion
    this.setData({ viewportHeight, keyboardHeight: height, keyboardOffset }, () => {
      if (!social.active(this, version)) return
      if (height && this._focused) this.scrollToBottom()
      this.measureLayout()
    })
  },
  measureLayout() {
    if (!social.active(this) || !wx.createSelectorQuery) return
    const version = this._communityVersion
    wx.createSelectorQuery()
      .select('.consult-chat-composer').boundingClientRect()
      .select('.consult-chat-list').boundingClientRect()
      .exec(rects => {
        if (!social.active(this, version) || !rects || !rects[0]) return
        const composerHeight = Math.ceil(rects[0].height)
        if (composerHeight > 0 && composerHeight !== this.data.composerHeight) {
          this.setData({ composerHeight }, () => this.measureLayout())
          return
        }
        if (rects[1]) this._listHeight = rects[1].height
      })
  },
  onFocus(event) { this._focused = true; this.updateViewport(Math.max(0, Number(event.detail.height) || 0)) },
  onFocusKeyboard(event) { this.updateViewport(Math.max(0, Number(event.detail.height) || 0)) },
  onBlur() { this._focused = false }
})
