const { startSpeechRecording, removeAudio } = require('../../utils/speech-recorder')
const { getToken } = require('../../utils/request')
const { transcribeSpeech } = require('../../services/api')

Component({
  properties: {
    visible: { type: Boolean, value: false, observer(visible) {
      if (this._panelVisible === visible) return
      this._panelVisible = visible
      this.invalidateRecording()
      if (visible) this.setData({ phase: 'ready', text: '', error: '', seconds: 0, permissionDenied: false })
    } },
    draft: { type: String, value: '' },
    maxLength: { type:Number, value:4000 },
    disabled: { type: Boolean, value: false, observer(disabled) { if (disabled && this.data.visible) this.close() } },
    viewportHeight: { type: Number, value: 0 }
  },
  data: { phase: 'ready', text: '', error: '', seconds: 0, permissionDenied: false },
  lifetimes: { detached() { this.invalidateRecording() } },
  pageLifetimes: { hide() { this.close() } },
  methods: {
    invalidateRecording() {
      this._version = (this._version || 0) + 1
      if (this._recording) { this._recording.cancel(); this._recording = null }
      this.clearClock()
      this._confirmed = false
      this._holding = false
      this._holdSession = false
    },
    clearClock() { if (this._clock) clearInterval(this._clock); this._clock = null },
    isCurrent(version, token) { return this.data.visible && version === this._version && token === getToken() },
    acceptResult(version, token) {
      if (this.isCurrent(version, token)) return true
      if (this.data.visible && version === this._version && token !== getToken()) {
        this.close()
        if (!getToken()) wx.reLaunch({ url: '/pages/login/login' })
      }
      return false
    },
    beginHold() { return this.start() },
    endHold(cancelled = false) {
      if (!this._holdSession) return
      this._holding = false
      if (cancelled) { this.close(); return }
      if (this.data.phase === 'recording' || (this.data.phase === 'authorizing' && this._recording)) this.stop()
    },
    async start() {
      if (!this.data.visible || this.data.disabled || ['authorizing', 'recording', 'stopping', 'transcribing'].includes(this.data.phase)) return
      this.invalidateRecording()
      this._holdSession = true
      this._holding = true
      const version = this._version, token = getToken()
      this._token = token
      if (!token) { this.close(); wx.reLaunch({ url: '/pages/login/login' }); return }
      this._draft = (this.data.draft || '').trim()
      this.setData({ phase: 'authorizing', text: '', error: '', seconds: 0, permissionDenied: false })
      try {
        await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve,
          fail: () => reject(Object.assign(new Error('需要麦克风权限，请在设置中开启后重新录音'), { permissionDenied: true })) }))
        if (!this.acceptResult(version, token)) return
        // 首次授权弹窗期间松手，只完成授权，不在授权后偷偷开始录音。
        if (this._holdSession && !this._holding) { this.close(); return }
        this._recording = startSpeechRecording({
          onStart: () => {
            if (!this.isCurrent(version, token)) return
            this.setData({ phase: 'recording' })
            this._clock = setInterval(() => {
              if (this.isCurrent(version, token)) this.setData({ seconds: Math.min(60, this.data.seconds + 1) })
            }, 1000)
          },
          onStop: result => this.recognize(result, version, token),
          onError: error => {
            this.clearClock(); this._recording = null
            if (this.isCurrent(version, token)) this.setData({ phase: 'error', error: error.message })
          }
        })
      } catch (error) {
        if (this.isCurrent(version, token)) this.setData({ phase: 'error', error: error.message || '无法开始录音，请重试', permissionDenied: !!error.permissionDenied })
      }
    },
    stop() {
      if (!['recording', 'authorizing'].includes(this.data.phase) || !this._recording) return
      this.clearClock()
      this.setData({ phase: 'stopping' })
      this._recording.stop()
    },
    async recognize(result, version, token) {
      this.clearClock(); this._recording = null
      const path = result.tempFilePath
      if (!this.isCurrent(version, token)) { removeAudio(path); return }
      this.setData({ phase: 'transcribing' })
      try {
        if (!path || !Number.isFinite(result.duration) || result.duration < 500) throw new Error('录音太短，请重新说一次')
        if (!Number.isFinite(result.fileSize) || result.fileSize > 512 * 1024) throw new Error('录音过大，请分段录制')
        const audioBase64 = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
          filePath: path, encoding: 'base64', success: result => resolve(result.data), fail: () => reject(new Error('录音无法读取，请重新录制'))
        }))
        if (!this.acceptResult(version, token)) return
        const response = await transcribeSpeech({ audioBase64, format: 'mp3', durationMs: Math.min(60000, Math.round(result.duration)) })
        if (!this.acceptResult(version, token)) return
        const recognized = response && typeof response.text === 'string' ? response.text.trim() : ''
        if (!recognized) throw new Error('没有听清，请靠近麦克风重新说一次')
        const text = this._draft ? `${this._draft}\n${recognized}` : recognized
        if (text.length > this.data.maxLength) throw new Error(`内容超过${this.data.maxLength}字，请分段输入`)
        this.setData({ phase: 'review', text })
      } catch (error) {
        if (this.data.visible && version === this._version && !getToken()) {
          this.close(); wx.reLaunch({ url: '/pages/login/login' })
        } else if (this.isCurrent(version, token)) {
          const message = error.statusCode === 404 ? '语音识别接口尚未就绪，请更新后端后重试' : error.message || '语音识别失败，请重新录制'
          this.setData({ phase: 'error', error: message })
        }
      } finally { removeAudio(path) }
    },
    edit(event) { if (this.data.phase === 'review') this.setData({ text: event.detail.value }) },
    retry() { this.close() },
    confirm() {
      const text = (this.data.text || '').trim()
      if (!this.data.visible || this.data.disabled || this.data.phase !== 'review' || !text || this._confirmed) return
      if (text.length > this.data.maxLength) return
      if (!getToken()) { this.close(); wx.reLaunch({ url: '/pages/login/login' }); return }
      if (this._token !== getToken()) { this.close(); return }
      this._confirmed = true
      this.triggerEvent('confirm', { text })
    },
    openSettings() { wx.openSetting({}) },
    close() { this.invalidateRecording(); if (this.data.visible) this.triggerEvent('close') },
    preventTouch() {}
  }
})
