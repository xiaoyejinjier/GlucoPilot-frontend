const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')
const media = require('../../utils/media')
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

  /** 发一轮文本消息：乐观插入用户气泡 → 写库 → 开流 */
  sendText(text) {
    this.appendRound(
      { id: this.nextLocalId(), role: 'user', type: 'text', content: text },
      { msgType: 1, contentText: text }
    )
  },

  /**
   * 发一轮图片消息：本地气泡先显示 → 上传（凭证/直传/登记）→ 写库 → 开流。
   * 与文本轮次共用 {@link startRound} 之后的全部链路，因此 SSE、幂等、重试语义完全一致。
   *
   * 用户在选图前已经输入的文字会作为 contentText 一起带上（后端支持「图 + 文字」），
   * 这正是两阶段里阶段 1 的识别线索来源。
   */
  sendImage(filePath) {
    const caption = (this.data.inputValue || '').trim()
    const userMsg = {
      id: this.nextLocalId(),
      role: 'user',
      type: 'image',
      imagePath: filePath,
      content: caption,
      /** 登记完成前为 true：用于在气泡上显示「图片上传中…」，此时还没有 mediaId */
      uploading: true
    }
    const aiMsg = { id: this.nextLocalId(), role: 'ai', type: 'text', content: '', pending: true }
    // 乐观插入：先让用户看到自己选的图，上传失败也不至于以为没选中
    this.setData({
      messages: this.data.messages.concat([userMsg, aiMsg]),
      sending: true,
      inputValue: '',
      scrollIntoView: 'msg-bottom'
    })
    this.uploadImageThenSend(userMsg.id, aiMsg.id)
  },

  /**
   * 上传一张图并在成功后开一轮。抽出来是为了让「首次发送」和「上传失败后重试」
   * 走同一段代码——两者只差一个调用入口，逻辑分叉迟早会出现只修一边的情况。
   */
  uploadImageThenSend(userLocalId, aiLocalId) {
    const userMsg = this.findMessage(userLocalId)
    if (!userMsg || !userMsg.imagePath) return

    media
      .uploadChatImage(userMsg.imagePath)
      .then((record) => {
        // imagePath 登记成功后替换为服务端 fileUrl：本地临时路径页内有效，换屏/重进会失效，
        // 而 fileUrl 由服务端解析、可长期引用（预览、重试均走它）。
        this.patchMessage(userLocalId, (m) => ({
          uploading: false,
          mediaId: record.id,
          fileUrl: record.fileUrl,
          imagePath: m.imagePath || record.fileUrl
        }))
        this.startRound(
          { msgType: 2, mediaId: record.id, contentText: userMsg.content || undefined },
          aiLocalId
        )
      })
      .catch((err) => {
        this.patchMessage(userLocalId, () => ({ uploading: false }))
        if (err && typeof err === 'object') {
          err.isUploadError = true
        }
        this.failRound(aiLocalId, err)
      })
  },

  /** 乐观插入「用户气泡 + AI 占位」并进入 startRound。图片轮次在上传完成后才走到这里。 */
  appendRound(userMsg, payload) {
    const aiMsg = { id: this.nextLocalId(), role: 'ai', type: 'text', content: '', pending: true }
    this.setData({
      messages: this.data.messages.concat([userMsg, aiMsg]),
      sending: true,
      scrollIntoView: 'msg-bottom'
    })
    this.startRound(payload, aiMsg.id)
  },

  startRound(payload, aiLocalId) {
    const clientMsgId = genClientMsgId()
    this.ensureSession()
      .then((sessionId) =>
        api.sendChatMessage(sessionId, Object.assign({ clientMsgId }, payload)).then((saved) => {
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
    // 图片上传类错误单独成文：这些消息是「图片过大/格式不对/上传失败」，归到
    // 「AI 服务不可用」会误导用户去排查对话链路，实际问题在文件上传
    const message = isAuth
      ? '登录已过期，请重新登录'
      : err && err.isUploadError
        ? (err.message || '图片上传失败，请重试')
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
    const userMsg = this.findUserMessageBefore(id)
    if (!userMsg) return
    this.patchMessage(id, () => ({ content: '', error: false, pending: true }))
    this.setData({ sending: true })

    const payload = this.payloadOf(userMsg)
    if (!payload) {
      // 图片停在「上传失败 / 未登记成功」：从本地临时路径重走一遍上传，
      // 而不是让用户重新选一次图——重试的意义就在于不用重做已经做过的部分
      this.patchMessage(userMsg.id, () => ({ uploading: true }))
      this.uploadImageThenSend(userMsg.id, id)
      return
    }
    this.startRound(payload, id)
  },

  /** 从本地气泡重建 2.24 的入参；图片尚未登记（没有 mediaId）时返回 null。 */
  payloadOf(userMsg) {
    if (userMsg.type === 'image') {
      if (!userMsg.mediaId) return null
      return { msgType: 2, mediaId: userMsg.mediaId, contentText: userMsg.content || undefined }
    }
    return { msgType: 1, contentText: userMsg.content }
  },

  findMessage(localId) {
    return this.data.messages.find((m) => m.id === localId) || null
  },

  /** 找某个 AI 气泡前面最近的一条用户气泡（整轮重发要连它一起重建）。 */
  findUserMessageBefore(aiLocalId) {
    const messages = this.data.messages
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].id === aiLocalId) {
        for (let k = i - 1; k >= 0; k -= 1) {
          if (messages[k].role === 'user') return messages[k]
        }
        return null
      }
    }
    return null
  },

  /** ---------- 图片 / 语音 ---------- */

  /**
   * 选图并发起一轮图片消息。
   * 只做「选」，上传与发送交给 sendImage，避免这个回调过长难以阅读。
   */
  onChooseImage() {
    if (this.data.sending) {
      wx.showToast({ title: '正在回复中，请稍候', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      // 压缩后再上传：原图常常超过视觉识别的 5MB 上限
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (file && file.tempFilePath) {
          this.sendImage(file.tempFilePath)
        }
      },
      fail: (err) => {
        // 用户主动取消不算错误，只有真正失败才提示
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' })
        }
      }
    })
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
