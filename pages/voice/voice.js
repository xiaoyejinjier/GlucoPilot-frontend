const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')
const app = getApp()

/** 增量文本合并刷新间隔：模型会推数百个 delta，逐个 setData 在真机上会卡 */
const DELTA_FLUSH_MS = 60
const GREETING = '你好，我是 AI 控糖助手。可以问饮食、血糖或今日记录相关问题。'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function genClientMsgId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

Page({
  data: {
    displayStyle: '',
    currentTime: '09:41',
    inputValue: '',
    scrollIntoView: '',
    voiceMode: false,
    recording: false,
    /** 正在等待/接收 AI 回复 */
    sending: false,
    messages: []
  },

  onLoad() {
    this._localSeq = 0
    this._sessionPromise = null
    this._deltaBuffer = ''
    this._deltaTimer = null
    this._currentRound = null
    this._lastRound = null
    this.setData({
      messages: [{ id: this.nextLocalId(), role: 'ai', type: 'text', content: GREETING }]
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    applyDisplayToCurrentPage()
    const now = new Date()
    this.setData({ currentTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` })

    if (!app.globalData.isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    // 提前把会话建好，用户真正发问时少一次往返等待
    this.ensureSession().catch(() => {})
  },

  onHide() {
    this.abortStream()
  },

  onUnload() {
    this.abortStream()
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer)
      this._deltaTimer = null
    }
  },

  /** ---------- 会话 ---------- */

  ensureSession() {
    if (this.data.sessionId) {
      return Promise.resolve(this.data.sessionId)
    }
    if (this._sessionPromise) {
      return this._sessionPromise
    }
    this._sessionPromise = api
      .getOrCreateChatSession(3)
      .then((session) => {
        this.setData({ sessionId: session.id })
        return session.id
      })
      .catch((err) => {
        this._sessionPromise = null
        throw err
      })
    return this._sessionPromise
  },

  /** ---------- 输入 ---------- */

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onSend() {
    const text = (this.data.inputValue || '').trim()
    if (!text) return
    if (this.data.sending) {
      wx.showToast({ title: '正在回复中，请稍候', icon: 'none' })
      return
    }
    this.setData({ inputValue: '' })
    this.sendText(text)
  },

  /** 发一轮新消息：乐观插入用户气泡 → 写库 → 开流 */
  sendText(text) {
    const userMsg = { id: this.nextLocalId(), role: 'user', type: 'text', content: text }
    const aiMsg = { id: this.nextLocalId(), role: 'ai', type: 'text', content: '', pending: true }
    this.setData({
      messages: this.data.messages.concat([userMsg, aiMsg]),
      sending: true,
      scrollIntoView: 'msg-bottom'
    })
    this.startRound(text, aiMsg.id)
  },

  startRound(text, aiLocalId) {
    const clientMsgId = genClientMsgId()
    this.ensureSession()
      .then((sessionId) =>
        api.sendChatMessage(sessionId, { clientMsgId, msgType: 1, contentText: text }).then((saved) => {
          this._currentRound = {
            sessionId,
            clientMsgId,
            replyToMsgId: saved.id,
            aiLocalId
          }
          this._lastRound = this._currentRound
          this.openStream()
        })
      )
      .catch((err) => this.failRound(aiLocalId, err))
  },

  /** ---------- SSE ---------- */

  openStream() {
    const round = this._currentRound
    if (!round) return
    this._deltaBuffer = ''
    this._streamTask = api.streamChatCompletion(
      round.sessionId,
      { clientMsgId: round.clientMsgId, replyToMsgId: round.replyToMsgId, stream: true },
      {
        onEvent: (name, payload) => {
          if (name === 'delta') {
            this.pushDelta(payload && payload.delta)
          } else if (name === 'done') {
            this.finishRound(round.aiLocalId, payload)
          } else if (name === 'error') {
            this.failRound(round.aiLocalId, new Error((payload && payload.message) || 'AI 服务暂时不可用'))
          }
        },
        onError: (err) => this.failRound(round.aiLocalId, err),
        onComplete: () => {
          // 兜底收尾：done 没到也要把缓冲刷出去并解除输入锁
          this.flushDelta()
          if (this.data.sending && this._currentRound) {
            this.failRound(round.aiLocalId, new Error('连接中断，请重试'))
          }
        }
      }
    )
  },

  abortStream() {
    if (this._streamTask) {
      this._streamTask.abort()
      this._streamTask = null
    }
  },

  pushDelta(delta) {
    if (!delta) return
    this._deltaBuffer += delta
    // 合并刷新：模型会推几百个 delta，逐个 setData 会卡
    if (this._deltaTimer) return
    this._deltaTimer = setTimeout(() => {
      this._deltaTimer = null
      this.flushDelta()
    }, DELTA_FLUSH_MS)
  },

  flushDelta() {
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer)
      this._deltaTimer = null
    }
    const round = this._currentRound
    const chunk = this._deltaBuffer
    if (!round || !chunk) return
    this._deltaBuffer = ''
    this.patchMessage(round.aiLocalId, (m) => ({ content: (m.content || '') + chunk }))
    this.setData({ scrollIntoView: 'msg-bottom' })
  },

  finishRound(aiLocalId, payload) {
    this.flushDelta()
    const contentText = payload && payload.contentText ? payload.contentText : ''
    const finishReason = payload ? payload.finishReason : null
    this._currentRound = null
    this._streamTask = null
    this.patchMessage(aiLocalId, () => ({
      content: contentText || '（本次没有生成内容，可点击重新生成）',
      pending: false,
      error: !contentText,
      finishReason
    }))
    this.setData({ sending: false, scrollIntoView: 'msg-bottom' })
    if (finishReason === 2) {
      wx.showToast({ title: '回复过长被截断', icon: 'none' })
    }
  },

  failRound(aiLocalId, err) {
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer)
      this._deltaTimer = null
    }
    this._currentRound = null
    this._streamTask = null
    const isAuth = err && err.code === 40100
    const message = isAuth
      ? '登录已过期，请重新登录'
      : (err && err.message) || 'AI 服务暂时不可用，请稍后重试'
    // 已经流出的内容保留，只在后面追加重试入口
    this.patchMessage(aiLocalId, (m) => ({
      content: m.content ? `${m.content}\n\n[${message}]` : message,
      pending: false,
      error: true
    }))
    this.setData({ sending: false, scrollIntoView: 'msg-bottom' })
    if (isAuth) {
      app.globalData.isLoggedIn = false
      wx.setStorageSync('isLoggedIn', false)
      setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 800)
    }
  },

  onRetry(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.sending) return
    const last = this._lastRound

    // 用户消息已入库：复用同一 clientMsgId / replyToMsgId 重开流，
    // 服务端按 reply_to_msg_id 幂等（已生成则直接重放 done），不会重复扣费也不会产生重复用户消息
    if (last && last.aiLocalId === id && last.replyToMsgId) {
      this.patchMessage(id, () => ({ content: '', error: false, pending: true }))
      this.setData({ sending: true })
      this._currentRound = {
        sessionId: last.sessionId,
        clientMsgId: last.clientMsgId,
        replyToMsgId: last.replyToMsgId,
        aiLocalId: id
      }
      this.openStream()
      return
    }

    // 用户消息没写成功：整轮重发
    const text = this.findUserTextBefore(id)
    if (!text) return
    this.patchMessage(id, () => ({ content: '', error: false, pending: true }))
    this.setData({ sending: true })
    this.startRound(text, id)
  },

  findUserTextBefore(aiLocalId) {
    const messages = this.data.messages
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].id === aiLocalId) {
        for (let k = i - 1; k >= 0; k -= 1) {
          if (messages[k].role === 'user') return messages[k].content
        }
        return ''
      }
    }
    return ''
  },

  /** ---------- 图片 / 语音（后端 media、ASR 未实现，先明确告知而不是造假数据） ---------- */

  onChooseImage() {
    wx.showToast({ title: '图片对话暂未开放', icon: 'none' })
  },

  onToggleVoiceMode() {
    this.setData({ voiceMode: !this.data.voiceMode, recording: false })
  },

  onHoldStart() {
    if (!this.data.voiceMode || this.data.recording) return
    this.setData({ recording: true })
  },

  onHoldEnd() {
    if (!this.data.voiceMode || !this.data.recording) return
    this.setData({ recording: false })
    wx.showToast({ title: '语音对话暂未开放，请用文字提问', icon: 'none' })
  },

  onPreviewImage(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    wx.previewImage({ urls: [src], current: src })
  },

  /** ---------- 工具 ---------- */

  nextLocalId() {
    this._localSeq += 1
    return `m${this._localSeq}`
  },

  patchMessage(id, patchFn) {
    const messages = this.data.messages.map((m) => (m.id === id ? Object.assign({}, m, patchFn(m)) : m))
    this.setData({ messages })
  }
})
