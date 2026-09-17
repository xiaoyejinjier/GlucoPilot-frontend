const { getCalendarData, getRecords, getAllRecords } = require('../../utils/storage')
const { GLUCOSE_NODES } = require('../../utils/constants')
const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    year: 2026,
    month: 9,
    activeView: 'calendar',
    viewMode: 'month',
    selectedDay: 4,
    selectedCount: 0,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    calendarDays: [],
    dayRecords: [],
    monthRecordDays: 0,
    monthTotal: 0,
    compliance: 0,
    weekAvg: '6.7',
    weekMax: '7.8',
    weekMin: '6.2',
    slotStats: []
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    applyDisplayToCurrentPage()
    const now = new Date()
    if (!this._inited) {
      this.setData({ year: now.getFullYear(), month: now.getMonth() + 1, selectedDay: now.getDate() })
      this._inited = true
    }
    this.buildCalendar()
    this.buildMonthStats()
    this.buildWeekStats()
    if (this.data.activeView === 'glucose') {
      setTimeout(() => this.drawWeekChart(), 50)
    }
  },

  onSwitchView(e) {
    const view = e.currentTarget.dataset.view
    this.setData({ activeView: view })
    if (view === 'glucose') {
      setTimeout(() => this.drawWeekChart(), 80)
    }
  },

  onSwitchToCalendar() {
    this.setData({ activeView: 'calendar' })
  },

  onSwitchToGlucose() {
    this.setData({ activeView: 'glucose' })
    setTimeout(() => this.drawWeekChart(), 80)
  },

  onPrevMonth() {
    let { year, month } = this.data
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
    this.setData({ year, month, selectedDay: 1 })
    this.buildCalendar()
    this.buildMonthStats()
  },

  onNextMonth() {
    let { year, month } = this.data
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
    this.setData({ year, month, selectedDay: 1 })
    this.buildCalendar()
    this.buildMonthStats()
  },

  buildCalendar() {
    const { year, month, selectedDay } = this.data
    const calData = getCalendarData(year, month)
    const firstDay = new Date(year, month - 1, 1).getDay()
    const offset = firstDay === 0 ? 6 : firstDay - 1
    const daysInMonth = new Date(year, month, 0).getDate()
    const days = []

    for (let i = 0; i < offset; i++) days.push({ day: null })
    for (let d = 1; d <= daysInMonth; d++) {
      const info = calData[d] || {}
      days.push({ day: d, level: info.level || '', count: info.count || 0 })
    }

    const selected = days.find(d => d.day === selectedDay)
    this.setData({
      calendarDays: days,
      selectedCount: selected ? selected.count : 0
    })
    this.buildDayRecords(selectedDay)
  },

  buildDayRecords(day) {
    const { year, month } = this.data
    const p = n => (n < 10 ? '0' + n : '' + n)
    const key = `${year}-${p(month)}-${p(day)}`
    const all = getAllRecords()
    const dayData = all[key] || {}
    const list = []

    GLUCOSE_NODES.forEach(node => {
      const rec = dayData[node.id]
      if (!rec) return
      let text = ''
      if (rec.value != null) text = `${rec.value} mmol/L`
      else if (rec.type === 'meal') text = `饮食 ${rec.foods || '已记录'}`
      else text = '已记录'
      list.push({ id: node.id, name: node.name, text })
    })

    // 无真实数据时给示意（仅选中当日）
    if (list.length === 0) {
      list.push(
        { id: 'demo1', name: '早餐前', text: '5.8 mmol/L' },
        { id: 'demo2', name: '早餐后', text: '7.6 mmol/L' },
        { id: 'demo3', name: '午餐', text: '饮食 米饭+青菜' }
      )
    }

    this.setData({ dayRecords: list })
  },

  buildMonthStats() {
    const { year, month, calendarDays } = this.data
    let days = 0
    let total = 0
    calendarDays.forEach(d => {
      if (d.day && d.count) {
        days += 1
        total += d.count
      }
    })
    const daysInMonth = new Date(year, month, 0).getDate()
    const compliance = daysInMonth ? Math.round((days / daysInMonth) * 100) : 0
    this.setData({
      monthRecordDays: days || 8,
      monthTotal: total || 42,
      compliance: compliance || 68
    })
  },

  buildWeekStats() {
    const actual = [6.2, 6.8, 7.4, 6.5, 6.9, 7.8, 6.6]
    const avg = (actual.reduce((a, b) => a + b, 0) / actual.length).toFixed(1)
    this.setData({
      weekAvg: avg,
      weekMax: Math.max(...actual).toFixed(1),
      weekMin: Math.min(...actual).toFixed(1),
      slotStats: [
        { name: '早餐段', count: 12, pct: 80 },
        { name: '午餐段', count: 10, pct: 66 },
        { name: '晚餐段', count: 9, pct: 60 },
        { name: '其他', count: 5, pct: 33 }
      ]
    })
  },

  drawWeekChart() {
    const actual = [6.2, 6.8, 7.4, 6.5, 6.9, 7.8, 6.6]
    const predicted = [6.0, 6.5, 7.0, 6.3, 6.7, 7.5, 6.4]
    const labels = ['一', '二', '三', '四', '五', '六', '日']
    const brand = getTheme(getDisplaySettings().theme).brand

    const query = wx.createSelectorQuery()
    query.select('#weekChart').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio
      const width = res[0].width
      const height = res[0].height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)

      const pad = { l: 40, r: 12, t: 16, b: 28 }
      const cw = width - pad.l - pad.r
      const ch = height - pad.t - pad.b

      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = '#ddd'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pad.l, pad.t)
      ctx.lineTo(pad.l, pad.t + ch)
      ctx.lineTo(pad.l + cw, pad.t + ch)
      ctx.stroke()

      const minY = 4
      const maxY = 10
      const yTicks = [4, 6, 8, 10]

      // Y 轴刻度与数值
      ctx.fillStyle = '#888'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      yTicks.forEach((val) => {
        const y = pad.t + ch - ((val - minY) / (maxY - minY)) * ch
        ctx.strokeStyle = '#eee'
        ctx.beginPath()
        ctx.moveTo(pad.l, y)
        ctx.lineTo(pad.l + cw, y)
        ctx.stroke()
        ctx.fillStyle = '#888'
        ctx.fillText(String(val), pad.l - 6, y)
      })

      const stepX = cw / (actual.length - 1)
      const toPoint = (val, i) => ({
        x: pad.l + i * stepX,
        y: pad.t + ch - ((val - minY) / (maxY - minY)) * ch
      })

      const drawLine = (data, color, dashed) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 2.5
        ctx.setLineDash(dashed ? [5, 4] : [])
        ctx.beginPath()
        data.forEach((v, i) => {
          const p = toPoint(v, i)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()
        ctx.setLineDash([])
        if (!dashed) {
          data.forEach((v, i) => {
            const p = toPoint(v, i)
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
            ctx.fill()
          })
        }
      }

      drawLine(actual, brand, false)
      drawLine(predicted, '#576b95', true)

      ctx.fillStyle = '#888'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      labels.forEach((label, i) => {
        ctx.fillText(label, pad.l + i * stepX, height - 8)
      })
    })
  },

  onViewMode(e) {
    this.setData({ viewMode: e.currentTarget.dataset.mode })
  },

  onDayTap(e) {
    const day = e.currentTarget.dataset.day
    const selected = this.data.calendarDays.find(d => d.day === day)
    this.setData({
      selectedDay: day,
      selectedCount: selected ? selected.count : 0
    })
    this.buildDayRecords(day)
  },

  onExport() {
    wx.navigateTo({ url: '/pages/export-data/export-data' })
  },

  onGoAi() {
    wx.switchTab({ url: '/pages/ai/ai' })
  }
})
