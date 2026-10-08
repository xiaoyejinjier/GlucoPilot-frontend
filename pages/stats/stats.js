const { fetchGlucoseSummary, fetchGlucoseRecords } = require('../../services/api')
const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')

/** 一天一条，取区间内所有节点，供日历明细展示 */
function recordsOfDay(year, month, day) {
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  const date = `${year}-${p(month)}-${p(day)}`
  return fetchGlucoseRecords({ startDate: date, endDate: date, pageSize: 100 })
}

/** 根据实际周数据扩展 Y 轴，避免低于 4 或高于 10 的点画到坐标区外。 */
function getWeekYAxis(points) {
  const values = (points || [])
    .filter((point) => point.value != null && point.value !== '')
    .map((point) => Number(point.value))
    .filter((value) => Number.isFinite(value))
  const dataMin = values.length ? Math.min(...values) : 4
  const dataMax = values.length ? Math.max(...values) : 10
  const min = Math.max(0, Math.min(4, Math.floor(dataMin)))
  const max = Math.max(10, Math.ceil(dataMax))
  const range = Math.max(1, max - min)
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const value = min + (range * index) / 3
    return Number(value.toFixed(1))
  })
  return { min, max, ticks, values }
}

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
    weekAvg: '--',
    weekMax: '--',
    weekMin: '--',
    slotStats: [],
    weekPoints: [],
    loading: false
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
    this.loadSummary()
    if (this.data.activeView === 'glucose') this.scheduleWeekChart()
  },

  onHide() {
    this.cancelWeekChartDraw()
  },

  onUnload() {
    this.cancelWeekChartDraw()
  },

  onResize() {
    if (this.data.activeView === 'glucose') this.scheduleWeekChart()
  },

  loadSummary() {
    const { year, month } = this.data
    const requestVersion = (this._summaryRequestVersion || 0) + 1
    this._summaryRequestVersion = requestVersion
    this.setData({ loading: true })
    fetchGlucoseSummary({ year, month })
      .then((summary) => {
        if (requestVersion !== this._summaryRequestVersion) return
        this._summary = summary
        this.setData({
          loading: false,
          monthRecordDays: summary.monthRecordDays,
          monthTotal: summary.monthTotal,
          compliance: summary.compliance,
          weekAvg: summary.week.avg == null ? '--' : String(summary.week.avg),
          weekMax: summary.week.max == null ? '--' : String(summary.week.max),
          weekMin: summary.week.min == null ? '--' : String(summary.week.min),
          slotStats: summary.slotStats,
          weekPoints: summary.week.points
        }, () => {
          this.buildCalendar(summary.calendarMap)
          this.buildDayRecords(this.data.selectedDay)
          if (this.data.activeView === 'glucose') this.scheduleWeekChart()
        })
      })
      .catch((err) => {
        if (requestVersion !== this._summaryRequestVersion) return
        this.setData({ loading: false })
        wx.showToast({ title: err.message || '统计加载失败', icon: 'none' })
      })
  },

  buildCalendar(calendarMap) {
    const { year, month, selectedDay } = this.data
    const firstDay = new Date(year, month - 1, 1).getDay()
    const offset = firstDay === 0 ? 6 : firstDay - 1
    const daysInMonth = new Date(year, month, 0).getDate()
    const days = []

    for (let i = 0; i < offset; i++) days.push({ day: null })
    for (let d = 1; d <= daysInMonth; d++) {
      const info = calendarMap[d] || {}
      days.push({ day: d, level: info.level || '', count: info.count || 0 })
    }

    const selected = days.find((d) => d.day === selectedDay)
    this.setData({
      calendarDays: days,
      selectedCount: selected ? selected.count : 0
    })
  },

  buildDayRecords(day) {
    if (!day) {
      this.setData({ dayRecords: [] })
      return
    }
    const { year, month } = this.data
    recordsOfDay(year, month, day)
      .then((page) => {
        this.setData({
          dayRecords: (page.records || []).map((r) => ({
            id: r.id,
            name: r.nodeName,
            text: `${r.value} mmol/L`
          }))
        })
      })
      .catch(() => this.setData({ dayRecords: [] }))
  },

  onSwitchView(e) {
    const view = e.currentTarget.dataset.view
    this.setData({ activeView: view }, () => {
      if (view === 'glucose') this.scheduleWeekChart()
      else this.cancelWeekChartDraw()
    })
  },

  onSwitchToCalendar() {
    this.setData({ activeView: 'calendar' })
  },

  onSwitchToGlucose() {
    this.setData({ activeView: 'glucose' }, () => this.scheduleWeekChart())
  },

  onPrevMonth() {
    let { year, month } = this.data
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
    this.setData({ year, month, selectedDay: 1 })
    this.loadSummary()
  },

  onNextMonth() {
    let { year, month } = this.data
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
    this.setData({ year, month, selectedDay: 1 })
    this.loadSummary()
  },

  cancelWeekChartDraw() {
    this._chartDrawVersion = (this._chartDrawVersion || 0) + 1
    if (this._chartDrawTimer) {
      clearTimeout(this._chartDrawTimer)
      this._chartDrawTimer = null
    }
  },

  /** 等 setData 和 wx:if 完成布局后再测量 Canvas，并使旧绘制任务失效。 */
  scheduleWeekChart() {
    if (this.data.activeView !== 'glucose') return
    this.cancelWeekChartDraw()
    const drawVersion = this._chartDrawVersion
    const draw = () => this.drawWeekChart(drawVersion, 0)
    if (typeof wx.nextTick === 'function') wx.nextTick(draw)
    else this._chartDrawTimer = setTimeout(draw, 16)
  },

  /** 周曲线：只画实际值，无记录的天断开（不连线、不画点）。 */
  drawWeekChart(drawVersion, attempt) {
    if (drawVersion !== this._chartDrawVersion || this.data.activeView !== 'glucose') return

    const points = (this.data.weekPoints || []).map((point) => {
      const value = point.value == null || point.value === '' ? null : Number(point.value)
      return { ...point, value: Number.isFinite(value) ? value : null }
    })
    const labels = points.map((p) => p.label)
    const brand = getTheme(getDisplaySettings().theme).brand

    const query = wx.createSelectorQuery().in(this)
    query.select('#weekChart').fields({ node: true, size: true }).exec((res) => {
      if (drawVersion !== this._chartDrawVersion || this.data.activeView !== 'glucose') return
      if (!res[0] || !res[0].node || res[0].width <= 0 || res[0].height <= 0) {
        if (attempt < 4) {
          this._chartDrawTimer = setTimeout(() => this.drawWeekChart(drawVersion, attempt + 1), 50)
        }
        return
      }
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio
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

      const yAxis = getWeekYAxis(points)
      const minY = yAxis.min
      const maxY = yAxis.max
      const yTicks = yAxis.ticks

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

      const stepX = points.length > 1 ? cw / (points.length - 1) : 0
      const toPoint = (value, i) => ({
        x: pad.l + i * stepX,
        y: pad.t + ch - ((value - minY) / (maxY - minY)) * ch
      })

      if (yAxis.values.length === 0) {
        ctx.fillStyle = '#aaa'
        ctx.textAlign = 'center'
        ctx.fillText('本周暂无记录', pad.l + cw / 2, pad.t + ch / 2)
      } else {
        // 裁剪到坐标区域，异常值也不会覆盖横轴标签或相邻布局。
        ctx.save()
        ctx.beginPath()
        ctx.rect(pad.l, pad.t, cw, ch)
        ctx.clip()

        // 折线按连续段绘制，缺数据处自然断开。
        ctx.strokeStyle = brand
        ctx.lineWidth = 2.5
        ctx.beginPath()
        let started = false
        points.forEach((p, i) => {
          if (p.value == null) {
            started = false
            return
          }
          const point = toPoint(p.value, i)
          if (!started) {
            ctx.moveTo(point.x, point.y)
            started = true
          } else {
            ctx.lineTo(point.x, point.y)
          }
        })
        ctx.stroke()

        points.forEach((p, i) => {
          if (p.value == null) return
          const point = toPoint(p.value, i)
          ctx.fillStyle = brand
          ctx.beginPath()
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
          ctx.fill()
        })
        ctx.restore()
      }

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
    const selected = this.data.calendarDays.find((d) => d.day === day)
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
