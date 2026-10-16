const { applyDisplayToCurrentPage } = require('../../utils/display')
const {
  SESSION_STATUS,
  DEFAULT_TITLE,
  HISTORY_PAGE_SIZE,
  sessionGate,
  gateFromError,
  toIdString,
  mergeHistory
} = require('../../utils/chat-sessions')
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

function greetingMessage(id) {
  return { id, role: 'ai', type: 'text', content: GREETING }
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
    messages: [],
    /** 当前会话（开历史会话时来自会话列表，未指定时来自 /current） */
    sessionId: '',
    sessionTitle: '',
    sessionStatus: null,
    sessionStatusText: '',
    /** 已结束/已归档会话：只展示历史，输入区禁用 */
    sessionReadOnly: false,
    sessionNotice: '',
    /** 会话内历史还有更早的消息可加载 */
    historyHasMore: false,
    historyLoading: false
  },

  onLoad(options) {
    this._localSeq = 0
    this._sessionPromise = null
    this._deltaBuffer = ''
    this._deltaTimer = null
    this._currentRound = null
    this._lastRound = null
    this._sessionVersion = 0
    this._historyBeforeSeq = null
    // 支持带参数进入：pages/voice/voice?sessionId=48&sessionStatus=2。
    // 本页是 tabBar 页，wx.navigateTo 进不来，常规路径是历史列表页写
    // app.globalData.pendingChatSession 再 switchTab（见 consumePendingSession）；
    // 保留 query 解析是为了 reLaunch / 分享等"直接以本页为入口"的场景。
    const query = options || {}
    this._pendingOpen = query.sessionId
      ? { id: query.sessionId, sessionStatus: query.sessionStatus, title: query.sessionTitle || '' }
      : null
    if (!this._pendingOpen) {
      this.setData({ messages: [greetingMessage(this.nextLocalId())] })
    }
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

    // 当前会话在历史列表里被删掉了：留在页面上再发消息只会拿到 404，直接回到"未建会话"状态
    const event = this.consumeSessionEvent()
    if (event && event.type === 'deleted' && event.id === this.data.sessionId) {
      this.resetToFresh()
    }

    const pending = this.consumePendingSession()
    if (pending) {
      this.openSession(pending).catch(() => {})
      return
    }
    if (this.consumePendingNewChat()) {
      this.onNewChat()
      return
    }
    // 提前把会话建好，用户真正发问时少一次往返等待
    if (!this.data.sessionId) {
      this.ensureSession().catch(() => {})
    }
  },

  onHide() {
    this.abortStream()
  },

  onUnload() {
    // 让在途的历史请求失效，避免页面销毁后回写 setData
    this._sessionVersion = (this._sessionVersion || 0) + 1
    this.abortStream()
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer)
      this._deltaTimer = null
    }
  },

  /** ---------- 会话 ---------- */

  /**
   * 取"待打开的会话"。历史列表页与对话页都是 tabBar 页，switchTab 不支持带参数，
   * 所以用 app.globalData 传一次性意图；取走即清，避免下次进页面又跳回同一条历史。
   */
  consumePendingSession() {
    const pending = this._pendingOpen || (app.globalData && app.globalData.pendingChatSession) || null
    this._pendingOpen = null
    if (app.globalData) app.globalData.pendingChatSession = null
    return pending && pending.id ? pending : null
  },

  /** 历史列表页里发生的删除操作，回本页时消费一次（只关心"删的是不是当前会话"）。 */
  consumeSessionEvent() {
    const event = (app.globalData && app.globalData.chatSessionEvent) || null
    if (app.globalData) app.globalData.chatSessionEvent = null
    return event
  },

  /** 列表页空态的「开始新对话」：一次性标记，消费即清。 */
  consumePendingNewChat() {
    const pending = !!(app.globalData && app.globalData.pendingNewChat)
    if (app.globalData) app.globalData.pendingNewChat = false
    return pending
  },

  nextSessionVersion() {
    this._sessionVersion = (this._sessionVersion || 0) + 1
    return this._sessionVersion
  },

  /** 把 sessionGate 的结果铺平成页面 data 字段。 */
  gateData(gate) {
    return {
      sessionStatus: gate.sessionStatus,
      sessionStatusText: gate.sessionStatusText,
      sessionReadOnly: gate.readOnly,
      sessionNotice: gate.notice
    }
  },

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
        this.setData(Object.assign({
          sessionId: toIdString(session.id),
          sessionTitle: session.title || DEFAULT_TITLE
        }, this.gateData(sessionGate(session.sessionStatus))))
        return toIdString(session.id)
      })
      .catch((err) => {
        this._sessionPromise = null
        throw err
      })
    return this._sessionPromise
  },

  /**
   * 打开指定会话：拉该会话的历史（后端已按时间正序返回）并渲染，不走 /current。
   * 已结束/已归档的会话照常展示历史，但输入区禁用并给出明确提示。
   */
  openSession(info) {
    const sessionId = toIdString(info && info.id)
    if (!sessionId) return Promise.resolve(null)
    const version = this.nextSessionVersion()
    this.abortStream()
    this._sessionPromise = null
    this._currentRound = null
    this._lastRound = null
    this._historyBeforeSeq = null

    this.setData(Object.assign({
      sessionId,
      sessionTitle: (info && info.title) || '',
      messages: [],
      inputValue: '',
      scrollIntoView: '',
      historyHasMore: false,
      historyLoading: true
    }, this.gateData(sessionGate(info && info.sessionStatus))))

    return api
      .fetchChatHistory(sessionId, { pageSize: HISTORY_PAGE_SIZE })
      .then((page) => {
        if (version !== this._sessionVersion) return null
        this._historyBeforeSeq = page.nextBeforeSeq
        const messages = page.messages.length ? page.messages : this.emptyHistoryMessages()
        this.setData({
          messages,
          historyHasMore: !!page.hasMore,
          historyLoading: false,
          scrollIntoView: 'msg-bottom'
        })
        return page
      })
      .catch((err) => {
        if (version !== this._sessionVersion) return null
        this.setData({ historyLoading: false })
        // 会话已被删除（后端 404 / 40400）：停在一条不存在的会话上没有意义，
        // 回到初始状态，下次发送时按"取或建当前会话"重新拿一条
        if (err && (err.code === 40400 || err.statusCode === 404)) {
          this.resetToFresh()
          wx.showToast({ title: '该对话已被删除', icon: 'none' })
          return null
        }
        wx.showToast({ title: (err && err.message) || '历史记录加载失败，请稍后重试', icon: 'none' })
        return null
      })
  },

  /** 空历史占位：可发送的会话给问候语，只读会话给一句"没有记录"，都不留白屏。 */
  emptyHistoryMessages() {
    if (this.data.sessionReadOnly) {
      return [{ id: this.nextLocalId(), role: 'ai', type: 'text', content: '这段对话没有可展示的记录' }]
    }
    return [greetingMessage(this.nextLocalId())]
  },

  /** 拉到更早的一页历史，拼到当前消息前面，保持整段对话正序。 */
  onLoadEarlier() {
    const sessionId = this.data.sessionId
    if (!sessionId || this.data.historyLoading) return
    // hasMore 与 beforeSeq 都要有，缺一个就说明后面没有更早的消息了：
    // 只判 beforeSeq 不够——最后一页同样会带回一个 nextBeforeSeq，会多打一次空请求
    if (!this.data.historyHasMore || !this._historyBeforeSeq) {
      wx.showToast({ title: '已经是全部记录了', icon: 'none' })
      return
    }
    const version = this._sessionVersion
    const anchor = this.data.messages.length ? this.data.messages[0].id : ''
    this.setData({ historyLoading: true })
    api
      .fetchChatHistory(sessionId, { pageSize: HISTORY_PAGE_SIZE, beforeSeq: this._historyBeforeSeq })
      .then((page) => {
        if (version !== this._sessionVersion || sessionId !== this.data.sessionId) return
        this._historyBeforeSeq = page.nextBeforeSeq
        this.setData({
          messages: mergeHistory(page.messages, this.data.messages),
          historyHasMore: !!page.hasMore,
          historyLoading: false,
          // 把原来最上面那条钉在可视区顶部，插进更早的消息后阅读位置不会跳
          scrollIntoView: anchor
        })
      })
      .catch((err) => {
        if (version !== this._sessionVersion) return
        this.setData({ historyLoading: false })
        wx.showToast({ title: (err && err.message) || '更早的记录加载失败', icon: 'none' })
      })
  },

  /** 新对话：后端会把旧会话置为"已结束"，这里清空视图并切到新会话。 */
  onNewChat() {
    if (this.data.sending) {
      wx.showToast({ title: '正在回复中，请稍候', icon: 'none' })
      return Promise.resolve(null)
    }
    if (this._creatingSession) return Promise.resolve(null)
    this._creatingSession = true

    return api
      .createChatSession(3)
      .then((session) => {
        const version = this.nextSessionVersion()
        this.abortStream()
        this._sessionPromise = null
        this._currentRound = null
        this._lastRound = null
        this._historyBeforeSeq = null
        // 本地消息 id 从 1 重新开始：新会话的视图是全新的，不复用旧序号
        this._localSeq = 0
        const gate = sessionGate(session && session.sessionStatus != null
          ? session.sessionStatus
          : SESSION_STATUS.ACTIVE)
        this.setData(Object.assign({
          sessionId: toIdString(session && session.id),
          sessionTitle: (session && session.title) || DEFAULT_TITLE,
          messages: [greetingMessage(this.nextLocalId())],
          inputValue: '',
          scrollIntoView: 'msg-bottom',
          historyHasMore: false,
          historyLoading: false
        }, this.gateData(gate)))
        if (version !== this._sessionVersion) return null
        wx.showToast({ title: '已开启新对话', icon: 'none' })
        return session
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '新建对话失败，请稍后重试', icon: 'none' })
        return null
      })
      .then((result) => {
        this._creatingSession = false
        return result
      })
  },

  /** 打开历史会话列表页 */
  onOpenHistory() {
    wx.navigateTo({ url: '/pages/voice/history' })
  },

  /** 当前会话被删除后回到"还没有会话"的初始状态。 */
  resetToFresh() {
    this.nextSessionVersion()
    this.abortStream()
    this._sessionPromise = null
    this._currentRound = null
    this._lastRound = null
    this._historyBeforeSeq = null
    this._localSeq = 0
    this.setData(Object.assign({
      sessionId: '',
      sessionTitle: '',
      messages: [greetingMessage(this.nextLocalId())],
      inputValue: '',
      scrollIntoView: 'msg-bottom',
      historyHasMore: false,
      historyLoading: false
    }, this.gateData(sessionGate(SESSION_STATUS.ACTIVE))))
  },

  /** 已结束/已归档会话：不进入发送链路（后端也会拒绝，没必要让用户先看到一条失败气泡）。 */
  blockIfReadOnly() {
    if (!this.data.sessionReadOnly) return false
    wx.showToast({ title: this.data.sessionNotice || '该会话已结束，请新建对话', icon: 'none' })
    return true
  },

  /** ---------- 输入 ---------- */

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onSend() {
    if (this.blockIfReadOnly()) return
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
    if (this.blockIfReadOnly()) return
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
    // 兜底：入口（onSend / onChooseImage / onRetry）都拦了，这里再挡一次，
    // 保证没有任何路径会把消息发给已结束/已归档的会话
    if (this.data.sessionReadOnly) {
      this.failRound(aiLocalId, new Error(this.data.sessionNotice || '该会话已结束，请新建对话'))
      return
    }
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
    // 后端明确拒绝（已结束/已归档）时顺手把输入区切成只读：错误文案本身就是提示，
    // 但"能不能发"的判断以服务端为准，所以这里跟着服务端把界面状态补上
    const statusGate = gateFromError(err)
    if (statusGate) {
      this.setData(this.gateData(statusGate))
    }
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
    if (this.blockIfReadOnly()) return
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
    if (this.blockIfReadOnly()) return
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
