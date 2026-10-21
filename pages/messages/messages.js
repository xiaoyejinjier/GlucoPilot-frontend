const api = require('../../services/api')
const social = require('../../utils/community')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const notifications = require('../../utils/message-notifications')
const EMOJIS = ['😀','😊','🥰','😄','😂','😉','🤗','🤔','😮','🥺','😢','😅','👍','👏','🙌','💪','🙏','❤️','💙','🌹','🎉','☀️','🌙','🍎','🥗','🍚','🏃','✅']
Page({
  data: { displayStyle: '', peer: null, me:null, refreshing:false, pulling:false, bottomPull:0, edgeReturning:false, messages: [], input: '', loading: false, sending: false,
    error: '', ready: false, hasMore: false, beforeId: null, scrollTarget: '',
    voiceMode:false, speechVisible:false, holdingSpeech:false, emojiVisible:false, emojis:EMOJIS, inputFocus:false, viewportHeight:0, keyboardHeight:0 },
  onLoad(options) { this._peer = /^[1-9]\d{0,18}$/.test(String(options.peer || '')) ? String(options.peer) : '' },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken; social.begin(this); this.stopPolling(); this._loading = false
    this.clearRefreshFeedback(); this._refreshTask = this._messageReadTask = null; this._edgeTouch=null; this._atBottom=false; this._scrollTop=0; this._scrollHeight=0
    this.attachKeyboard()
    if (previous && previous !== this._communityToken) { this._attempt = null; this.setData({ messages: [], input: '', peer: null, me:null, beforeId: null, hasMore: false }) }
    this.setData({ sending: false, loading: false, ready: false, refreshing:false, speechVisible:false, holdingSpeech:false, emojiVisible:false }); applyDisplayToCurrentPage()
    const version = this._communityVersion
    if (!this._peer) { this.setData({ error: '用户不存在' }); return }
    api.fetchCommunityProfile(`u${this._peer}`).then(peer => { if (social.active(this, version)) { this.setData({ peer }); wx.setNavigationBarTitle({ title: peer.nickname }) } }).catch(error => social.failure(this, error, version))
    api.fetchMe().then(me=>{if(social.active(this,version))this.setData({me:{...me,key:me.communityKey}})}).catch(error=>social.failure(this,error,version))
    this.loadLatest(); this._pollTimer = setInterval(() => this.loadLatest(true), 5000)
  },
  stopPolling() { if (this._pollTimer) clearInterval(this._pollTimer); this._pollTimer = null },
  onHide() {
    this.onCloseSpeechInput(); social.end(this); this.stopPolling(); this.clearRefreshFeedback(); this._edgeTouch=null
    this.setData({pulling:false,bottomPull:0,edgeReturning:false})
    if (this._keyboardHandler && wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(this._keyboardHandler)
    this._keyboardHandler = null; this.setData({ keyboardHeight:0,inputFocus:false })
  }, onUnload() { this.onHide() },
  attachKeyboard() {
    try { const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); this._fullHeight = this._windowHeight = info.windowHeight; this.updateViewport(0) } catch (_) {}
    if (!this._keyboardHandler && wx.onKeyboardHeightChange && wx.offKeyboardHeightChange) {
      this._keyboardHandler = event => { if (social.active(this)) this.updateViewport(Number(event.height)) }
      wx.onKeyboardHeightChange(this._keyboardHandler)
    }
  },
  updateViewport(height = this.data.keyboardHeight) {
    if (!this._fullHeight || !Number.isFinite(height) || height < 0) return
    this.setData({ keyboardHeight:height, viewportHeight:Math.max(1,Math.min(this._windowHeight,this._fullHeight-height)) },()=>this.measureList())
  },
  onResize(event) {
    const height = Number(event.size && event.size.windowHeight)
    if (!social.active(this) || !Number.isFinite(height) || height < 1) return
    this._windowHeight = height
    if (!this.data.inputFocus && !this.data.speechVisible && !this.data.keyboardHeight) this._fullHeight = height
    this.updateViewport()
  },
  onInput(event) { this._cursor = event.detail.cursor; this.setData({ input: event.detail.value }) },
  onInputBlur(event) { this._cursor = event.detail.cursor; this.setData({ inputFocus:false }) },
  onInputFocus(event) { this.setData({ emojiVisible:false,inputFocus:true }); if (event.detail && event.detail.height) this.updateViewport(Number(event.detail.height)) },
  onToggleEmoji() {
    if (!social.active(this) || this.data.sending || this.data.speechVisible) return
    this.setData({ emojiVisible:!this.data.emojiVisible, voiceMode:false, inputFocus:false })
    if (wx.hideKeyboard) wx.hideKeyboard()
  },
  onEmoji(event) {
    const emoji = event.currentTarget.dataset.emoji
    if (!EMOJIS.includes(emoji) || this.data.sending || !social.active(this)) return
    const input = this.data.input, cursor = Number.isInteger(this._cursor) && this._cursor >= 0 ? Math.min(this._cursor,input.length) : input.length
    const value = input.slice(0,cursor) + emoji + input.slice(cursor)
    if (value.length > 1000) return wx.showToast({ title:'消息最多1000字', icon:'none' })
    this._cursor = cursor + emoji.length; this.setData({ input:value })
  },
  onToggleVoiceMode() {
    if (!social.active(this) || this.data.sending || !this.data.ready) return
    this.onCloseSpeechInput()
    this.setData({ voiceMode:!this.data.voiceMode, emojiVisible:false, inputFocus:this.data.voiceMode })
    if (wx.hideKeyboard) wx.hideKeyboard()
  },
  onHoldStart(event) {
    if (!social.active(this) || !this.data.voiceMode || this.data.speechVisible || this.data.sending || !this.data.ready) return
    if (event && event.touches && event.touches.length !== 1) return
    this._speechHeld = true; this._speechStarted = false
    this.setData({ speechVisible:true, holdingSpeech:true, inputFocus:false },() => {
      if (!this._speechHeld || !this.data.speechVisible) return
      const speech = this.selectComponent('#speechInput')
      if (!speech) return this.onCloseSpeechInput()
      this._speechStarted = true; speech.beginHold()
    })
  },
  onHoldEnd() {
    if (!this._speechHeld) return
    this._speechHeld = false; this.setData({ holdingSpeech:false })
    if (!this._speechStarted) return this.onCloseSpeechInput()
    const speech = this.selectComponent('#speechInput'); if (speech) speech.endHold()
  },
  onHoldCancel() { const speech = this.selectComponent('#speechInput'); if (speech) speech.endHold(true); this.onCloseSpeechInput() },
  onCloseSpeechInput() { this._speechHeld = this._speechStarted = false; this.setData({ speechVisible:false, holdingSpeech:false }) },
  onConfirmSpeechInput(event) {
    const text = String(event.detail.text || '').trim()
    if (!social.active(this) || !this.data.speechVisible || !this.data.voiceMode || this.data.sending || !text) return
    if (text.length > 1000) return wx.showToast({ title:'消息最多1000字，请修改', icon:'none' })
    this.onCloseSpeechInput(); this.setData({ input:text }); this.onSend()
  },
  onReportMessage(event) { const message = this.data.messages.find(item => item.id === String(event.currentTarget.dataset.id)); if (message && !message.mine && social.active(this)) social.report('MESSAGE',message.id) },
  onAvatar(e) {
    const profile=e.currentTarget.dataset.mine?this.data.me:this.data.peer
    if(social.active(this)&&profile&&/^[ub][1-9]\d{0,18}$/.test(profile.key||''))wx.navigateTo({url:`/pages/community-profile/community-profile?key=${profile.key}`})
  },
  onAvatarError(e){this.setData({[e.currentTarget.dataset.mine?'me.avatarFailed':'peer.avatarFailed']:true})},
  clearRefreshFeedback(){
    if(this._refreshTimer)clearTimeout(this._refreshTimer)
    this._refreshTimer=null
    if(this._releaseRefreshDelay)this._releaseRefreshDelay()
    this._releaseRefreshDelay=null;this.setData({refreshing:false,pulling:false})
  },
  onRefresherPulling(){if(social.active(this)&&!this.data.refreshing)this.setData({pulling:true})},
  onRefresherRestore(){if(!this.data.refreshing)this.setData({pulling:false})},
  onRefresh(){
    if(!social.active(this)||!this._peer){this.setData({refreshing:false,pulling:false});return Promise.resolve()}
    if(this._refreshTask)return this._refreshTask
    const version=this._communityVersion,pending=this._messageReadTask
    this._edgeTouch=null;this.setData({refreshing:true,pulling:false,bottomPull:0,edgeReturning:true})
    const feedback=new Promise(resolve=>{
      this._releaseRefreshDelay=resolve
      this._refreshTimer=setTimeout(()=>{this._refreshTimer=null;this._releaseRefreshDelay=null;resolve()},600)
    })
    const read=async()=>{if(pending)await pending;if(social.active(this,version))await this.loadLatest(true,true)}
    const task=Promise.all([feedback,read()]).finally(()=>{
      if(social.active(this,version))this.setData({refreshing:false,pulling:false})
      if(this._refreshTask===task)this._refreshTask=null
    })
    this._refreshTask=task;return task
  },
  measureList(){
    if(!social.active(this)||typeof wx.createSelectorQuery!=='function')return
    const version=this._communityVersion
    wx.createSelectorQuery().select('.dm-list').boundingClientRect().select('.dm-content').boundingClientRect().exec(rects=>{
      if(!social.active(this,version)||!rects[0]||!rects[1])return
      this._listHeight=rects[0].height;this._scrollHeight=rects[1].height;this.updateBottomEdge()
    })
  },
  updateBottomEdge(){if(this._listHeight>0)this._atBottom=this._scrollHeight-this._listHeight-(this._scrollTop||0)<=3},
  onMessageScroll(e){
    const top=Math.max(0,Number(e.detail.scrollTop)||0),old=this._scrollTop||0
    this._scrollTop=top;this._scrollHeight=Number(e.detail.scrollHeight)||this._scrollHeight
    if(this._listHeight>0)this.updateBottomEdge();else if(top<old-2)this._atBottom=false
  },
  onMessageLower(){this._atBottom=true},
  onMessageUpper(){this._atBottom=!!this._listHeight&&this._scrollHeight<=this._listHeight+3},
  onElasticStart(e){
    this._edgeTouch=null
    if(!social.active(this)||this.data.refreshing||this.data.speechVisible||!e.touches||e.touches.length!==1)return
    const point=e.touches[0];this._edgeTouch={x:point.clientX,y:point.clientY,engaged:false}
    this.setData({bottomPull:0,edgeReturning:false})
  },
  onElasticMove(e){
    if(!this._edgeTouch||!social.active(this)||this.data.refreshing||this.data.pulling)return
    if(!e.touches||e.touches.length!==1)return this.onElasticEnd()
    const point=e.touches[0],touch=this._edgeTouch
    if(!this._atBottom&&!touch.engaged){touch.x=point.clientX;touch.y=point.clientY;return}
    const distance=touch.y-point.clientY
    if(!touch.engaged&&(distance<6||distance<Math.abs(point.clientX-touch.x)))return
    touch.engaged=true
    const bottomPull=Math.round(Math.min(64,Math.max(0,distance)*0.32))
    if(bottomPull!==this.data.bottomPull)this.setData({bottomPull})
  },
  onElasticEnd(){this._edgeTouch=null;if(this.data.bottomPull)this.setData({bottomPull:0,edgeReturning:true})},
  trackMessageRead(task){
    this._messageReadTask=task
    const done=()=>{if(this._messageReadTask===task)this._messageReadTask=null}
    task.then(done,done);return task
  },
  onRetry() { return this.loadLatest() },
  loadLatest(quiet=false,preservePosition=false){
    if(this._loading)return this._messageReadTask||Promise.resolve()
    return this.trackMessageRead(this.readLatest(quiet,preservePosition))
  },
  async readLatest(quiet = false, preservePosition = false) {
    if (!social.active(this) || !this._peer || this._loading) return
    this._loading = true; const version = this._communityVersion
    if (!quiet) this.setData({ loading: true }); this.setData({ error: '' })
    try {
      const page = await api.fetchDirectMessages(this._peer, { pageSize: 50 })
      if (!social.active(this, version)) return
      const oldLast = this.data.messages[this.data.messages.length - 1], empty = !this.data.messages.length
      const known = new Set(this.data.messages.map(item => item.id))
      // After a long absence, use a contiguous latest page instead of silently leaving a gap.
      const reset = !empty && page.hasMore && !page.records.some(item => known.has(item.id))
      const messages = social.mergeMessages(reset ? [] : this.data.messages, page.records)
      const last = messages[messages.length - 1], changed = last && (!oldLast || last.id !== oldLast.id)
      this.setData({ messages, ready: true, ...(empty || reset ? { hasMore: page.hasMore, beforeId: page.nextBeforeId } : {}),
        ...(changed && !preservePosition && !this.data.refreshing ? { scrollTarget: `dm-${last.id}` } : {}) },()=>this.measureList())
      if (page.records.length) api.readDirectMessages(this._peer, page.records[page.records.length - 1].id).then(() => { if (social.active(this,version)) notifications.refresh() }).catch(error => { if (error.code === 40100) social.failure(this, error, version) })
    } catch (error) { if (social.active(this, version, error)) { this.setData({ error: error.message || '消息加载失败，点击重试' }); if (!quiet || error.code === 40100) social.failure(this, error, version) } }
    finally { if (social.active(this, version)) { this._loading = false; this.setData({ loading: false }) } }
  },
  onOlder(){if(this._loading)return this._messageReadTask||Promise.resolve();return this.trackMessageRead(this.readOlder())},
  async readOlder() {
    if (!social.active(this) || this._loading || !this.data.hasMore || !this.data.beforeId) return
    this._loading = true; const version = this._communityVersion, anchor = this.data.messages[0]
    this.setData({ loading: true })
    try {
      const page = await api.fetchDirectMessages(this._peer, { pageSize: 50, beforeId: this.data.beforeId })
      if (!social.active(this, version)) return
      this.setData({ messages: social.mergeMessages(this.data.messages, page.records), hasMore: page.hasMore,
        beforeId: page.nextBeforeId, ...(anchor ? { scrollTarget: `dm-${anchor.id}` } : {}) },()=>this.measureList())
    } catch (error) { social.failure(this, error, version) }
    finally { if (social.active(this, version)) { this._loading = false; this.setData({ loading: false }) } }
  },
  async onSend() {
    const content = this.data.input.trim()
    if (!social.active(this) || !this._peer || !this.data.ready || this.data.sending || !content) return
    if (content.length > 1000) { wx.showToast({ title: '消息最多1000字', icon: 'none' }); return }
    if (!this._attempt || this._attempt.content !== content) this._attempt = { content, clientRequestId: social.requestId() }
    const payload = this._attempt, version = this._communityVersion; this.setData({ sending: true })
    try {
      const message = await api.sendDirectMessage(this._peer, payload)
      if (!social.active(this, version)) return
      this._attempt = null
      this._cursor = 0
      this.setData({ input: '', emojiVisible:false, messages: social.mergeMessages(this.data.messages, [message]), scrollTarget: `dm-${message.id}` })
      this.loadLatest(true)
    } catch (error) { social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ sending: false }) }
  }
})
