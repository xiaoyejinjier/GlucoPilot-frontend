/**
 * 滑动解锁：拖到最右侧触发 unlock 事件。
 *
 * 纯 UX 门槛：不采集轨迹、不比对答案，前端只负责“用户确实拖到了最右”，
 * 真正的防刷由服务端一次性票据 + 频控承担。
 */
Component({
  properties: {
    hint: { type: String, value: '按住滑块，拖动到最右侧' }
  },

  data: {
    x: 0,
    maxX: 0,
    unlocked: false
  },

  lifetimes: {
    ready() {
      this.measure()
    }
  },

  methods: {
    /** 量一次轨道与滑块宽度，算出可拖动的最远距离。 */
    measure() {
      this.createSelectorQuery()
        .select('.slider-area')
        .boundingClientRect()
        .select('.slider-thumb')
        .boundingClientRect()
        .exec((res) => {
          if (!res || !res[0] || !res[1]) return
          this.setData({ maxX: Math.max(0, res[0].width - res[1].width) })
        })
    },

    onChange(e) {
      this._x = Number(e.detail.x) || 0
    },

    onTouchEnd() {
      if (this.data.unlocked) return
      const maxX = this.data.maxX
      if (maxX > 0 && this._x >= maxX - 2) {
        this.setData({ unlocked: true, x: maxX })
        this.triggerEvent('unlock')
      } else {
        // 未拖到最右：回弹并保持锁定
        this.setData({ x: 0 })
      }
    },

    reset() {
      this._x = 0
      this.setData({ x: 0, unlocked: false })
    }
  }
})
