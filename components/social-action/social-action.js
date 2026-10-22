Component({
  properties: {
    kind: { type: String, value: 'like' }, active: { type: Boolean, value: false },
    label: { type: String, value: '' }, count: { type: Number, value: 0 }, pulse: { type: Number, value: 0 }
  },
  data: { pulsing: false },
  observers: { pulse(value) {
    if(value === this._lastPulse)return
    this._lastPulse=value
    if (this._ready && !this._hidden && value > 0) this.animate()
  } },
  lifetimes: {
    attached() { this._lastPulse=this.data.pulse; this._ready = true; this._hidden = false },
    detached() { this._ready = false; this.stop() }
  },
  pageLifetimes: {
    hide() { this._hidden = true; this.stop() },
    show() { this._hidden = false }
  },
  methods: {
    animate() {
      this.stop()
      const version = this._version
      this.setData({ pulsing: false }, () => {
        if (!this._ready || this._hidden || version !== this._version) return
        this.setData({ pulsing: true })
        this._timer = setTimeout(() => {
          if (this._ready && !this._hidden && version === this._version) this.setData({ pulsing: false })
        }, 480)
      })
    },
    stop() {
      this._version = (this._version || 0) + 1
      if (this._timer) clearTimeout(this._timer)
      this._timer = null
      this.setData({ pulsing: false })
    }
  }
})
