Component({
  properties: { aboveTab: { type: Boolean, value: false } },
  data: { visible: false, message: '', keyboardHeight: 0 },
  lifetimes: {
    attached() { this._active = true; this.listenKeyboard() },
    detached() { this._active = false; this.reset(); this.unlistenKeyboard() }
  },
  pageLifetimes: {
    show() { this._active = true; this.listenKeyboard() },
    hide() { this._active = false; this.reset(); this.unlistenKeyboard() }
  },
  methods: {
    show(message) {
      if (!this._active || typeof message !== 'string' || !message) return
      this.reset()
      const version = this._version
      this.setData({ visible: false }, () => {
        if (!this._active || version !== this._version) return
        this.setData({ visible: true, message })
        this._timer = setTimeout(() => {
          if (this._active && version === this._version) this.setData({ visible: false })
        }, 1800)
      })
    },
    reset() {
      this._version = (this._version || 0) + 1
      if (this._timer) clearTimeout(this._timer)
      this._timer = null
      this.setData({ visible: false, message: '' })
    },
    listenKeyboard() {
      if (this._keyboardListener || typeof wx.onKeyboardHeightChange !== 'function') return
      this._keyboardListener = event => {
        if (this._active) this.setData({ keyboardHeight: Math.max(0, Number(event.height) || 0) })
      }
      wx.onKeyboardHeightChange(this._keyboardListener)
    },
    unlistenKeyboard() {
      if (this._keyboardListener && typeof wx.offKeyboardHeightChange === 'function') wx.offKeyboardHeightChange(this._keyboardListener)
      this._keyboardListener = null
      this.setData({ keyboardHeight: 0 })
    }
  }
})
