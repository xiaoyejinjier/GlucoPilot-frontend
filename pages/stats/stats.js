const { fetchGlucoseSummary, fetchGlucoseRecords, fetchDayMeals } = require('../../services/api')
const { GLUCOSE_NODES } = require('../../utils/constants')
const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')
const { parseLocalDate, getNaturalWeek, getWeekRangeText, getMonthWeeks } = require('../../utils/stats-week')
const { buildMealDetails } = require('../../utils/meal-details')

/** 同时拉取六个血糖节点和三个正餐节点，供“日”视图拼成完整九时段。 */
function recordsOfDay(year, month, day) {
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  const date = `${year}-${p(month)}-${p(day)}`
  return Promise.all([
    fetchGlucoseRecords({ startDate: date, endDate: date, pageSize: 100 }),
    fetchDayMeals(date)
  ]).then(([glucosePage, mealDay]) => ({
    date,
    glucoseRecords: (glucosePage && glucosePage.records) || [],
    meals: (mealDay && mealDay.meals) || []
  }))
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
    months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1 })),
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    calendarDays: [],
    dayRecords: [],
    expandedMealId: '',
    dayLoading: false,
    dayLoadFailed: false,
    dayCompleted: 0,
    dayCompletion: 0,
    dayGlucoseAvg: '--',
    monthRecordDays: 0,
    monthTotal: 0,
    compliance: 0,
    weekAvg: '--',
    weekMax: '--',
    weekMin: '--',
    slotStats: [],
    weekPoints: [],
    weekRangeText: '',
    weekAnchorDate: '',
    weekLoadFailed: false,
    showWeekPicker: false,
    weekPickerYear: 2026,
    weekPickerMonth: 9,
    weekPickerMonthValue: '',
    weekPickerOptions: [],
    weekChartError: false,
    loading: false
  },

  onShow() {
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
    this.setData({ expandedMealId: '' })
    this.cancelWeekChartDraw()
    this._summaryRequestVersion = (this._summaryRequestVersion || 0) + 1
    this._dayRequestVersion = (this._dayRequestVersion || 0) + 1
    if (this.data.showWeekPicker) this.setData({ showWeekPicker: false })
  },

  onUnload() {
    this.cancelWeekChartDraw()
    this._summaryRequestVersion = (this._summaryRequestVersion || 0) + 1
    this._dayRequestVersion = (this._dayRequestVersion || 0) + 1
  },

  onResize() {
    if (this.data.activeView === 'glucose') this.scheduleWeekChart()
  },

  getSelectedWeek() {
    const { year, month, selectedDay } = this.data
    const override = parseLocalDate(this.data.weekAnchorDate)
    return override
      ? getNaturalWeek(override.getFullYear(), override.getMonth() + 1, override.getDate())
      : getNaturalWeek(year, month, selectedDay)
  },

  loadSummary() {
    this.setData({ expandedMealId: '' })
    const { year, month } = this.data
    const weekRange = this.getSelectedWeek()
    const requestVersion = (this._summaryRequestVersion || 0) + 1
    this._summaryRequestVersion = requestVersion
    this.cancelWeekChartDraw()
    // 同月选日保留日期格，只有换月/换年才移除旧月历，避免日历闪烁或错月。
    if (this._calendarMonthKey !== `${year}-${month}`) this.setData({ calendarDays: [] })
    this.setData({ loading: true, weekLoadFailed: false, weekPoints: [],
      weekAvg: '--', weekMax: '--', weekMin: '--',
      weekRangeText: getWeekRangeText(weekRange.startDate, weekRange.endDate) })
    // 日期明细独立加载，月历汇总失败时仍能展示已成功读取的真实日记录。
    if (this.data.activeView === 'calendar' && this.data.viewMode === 'day') {
      this.buildDayRecords(this.data.selectedDay)
    }
    return fetchGlucoseSummary({ year, month, ...weekRange })
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
          weekPoints: summary.week.points,
          weekRangeText: getWeekRangeText(
            summary.week.startDate || weekRange.startDate,
            summary.week.endDate || weekRange.endDate
          )
        }, () => {
          if (requestVersion !== this._summaryRequestVersion) return
          this.buildCalendar(summary.calendarMap)
          if (this.data.activeView === 'glucose') this.scheduleWeekChart()
        })
      })
      .catch((err) => {
        if (requestVersion !== this._summaryRequestVersion) return
        this.setData({ loading: false, weekLoadFailed: true })
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
    this._calendarMonthKey = `${year}-${month}`
    this.setData({
      calendarDays: days,
      selectedCount: selected ? selected.count : 0
    })
  },

  buildDayRecords(day) {
    this.setData({ expandedMealId: '' })
    if (!day) {
      this.setData({ dayRecords: [], dayCompleted: 0, dayCompletion: 0, dayGlucoseAvg: '--' })
      return
    }
    const { year, month } = this.data
    const requestVersion = (this._dayRequestVersion || 0) + 1
    this._dayRequestVersion = requestVersion
    this.setData({ dayLoading: true, dayLoadFailed: false, dayRecords: [],
      dayCompleted: 0, dayCompletion: 0, dayGlucoseAvg: '--' })
    return recordsOfDay(year, month, day)
      .then(({ date, glucoseRecords, meals }) => {
        if (requestVersion !== this._dayRequestVersion) return
        const glucoseByNode = {}
        const mealByNode = {}
        glucoseRecords.forEach((record) => { glucoseByNode[record.nodeCode] = record })
        meals.forEach((meal) => { mealByNode[meal.nodeCode] = meal })

        const glucoseValues = glucoseRecords
          .filter((record) => record.value != null && record.value !== '')
          .map((record) => Number(record.value))
          .filter((value) => Number.isFinite(value))
        const dayRecords = GLUCOSE_NODES.map((node) => {
          if (node.isMeal) {
            const meal = mealByNode[node.id]
            return {
              id: node.id,
              name: node.name,
              kind: 'meal',
              recorded: !!meal,
              detail: meal ? buildMealDetails(meal, date) : null,
              text: meal
                ? (meal.foodsText ? `已记录 · ${meal.foodsText}` : '正餐已记录')
                : '未记录'
            }
          }
          const record = glucoseByNode[node.id]
          return {
            id: node.id,
            name: node.name,
            kind: 'glucose',
            recorded: !!record,
            text: record ? `${record.value} mmol/L` : '未记录'
          }
        })
        const completed = dayRecords.filter((record) => record.recorded).length
        const average = glucoseValues.length
          ? (glucoseValues.reduce((sum, value) => sum + value, 0) / glucoseValues.length).toFixed(1)
          : '--'
        this.setData({
          dayRecords,
          selectedCount: completed,
          dayCompleted: completed,
          dayCompletion: Math.round(completed * 100 / GLUCOSE_NODES.length),
          dayGlucoseAvg: average,
          dayLoading: false,
          dayLoadFailed: false
        })
      })
      .catch((err) => {
        if (requestVersion !== this._dayRequestVersion) return
        this.setData({
          dayRecords: [],
          dayCompleted: 0,
          dayCompletion: 0,
          dayGlucoseAvg: '--',
          dayLoading: false,
          dayLoadFailed: true
        })
        if (!err || err.code !== 40100) {
          wx.showToast({ title: (err && err.message) || '当日记录加载失败', icon: 'none' })
        }
      })
  },

  onMealDetailTap(e) {
    if (this.data.activeView !== 'calendar' || this.data.viewMode !== 'day'
      || this.data.dayLoading || this.data.dayLoadFailed) return
    const id = e.currentTarget.dataset.id
    const record = this.data.dayRecords.find((item) => item.id === id)
    if (!record || record.kind !== 'meal' || !record.recorded || !record.detail) return
    this.setData({ expandedMealId: this.data.expandedMealId === id ? '' : id })
  },

  onPreviewMealPhoto(e) {
    const record = this.data.dayRecords.find((item) => item.id === e.currentTarget.dataset.id)
    if (this.data.activeView !== 'calendar' || this.data.viewMode !== 'day' || this.data.dayLoading
      || !record || record.id !== this.data.expandedMealId || !record.detail || !record.detail.mediaUrl) return
    wx.previewImage({ current: record.detail.mediaUrl, urls: [record.detail.mediaUrl] })
  },

  onSwitchView(e) {
    const view = e.currentTarget.dataset.view
    this.setData({ activeView: view, showWeekPicker: false, expandedMealId: '' }, () => {
      if (view === 'glucose') this.scheduleWeekChart()
      else this.cancelWeekChartDraw()
    })
  },

  onSwitchToCalendar() {
    this.setData({ activeView: 'calendar', viewMode: 'month', showWeekPicker: false, expandedMealId: '' })
    this.cancelWeekChartDraw()
  },

  onSwitchToGlucose() {
    this.setData({ activeView: 'glucose', expandedMealId: '' }, () => this.scheduleWeekChart())
  },

  onPrevMonth() {
    let { year, month } = this.data
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
    this.setData({ year, month, selectedDay: 1, weekAnchorDate: '', viewMode: 'day' })
    return this.loadSummary()
  },

  onNextMonth() {
    let { year, month } = this.data
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
    this.setData({ year, month, selectedDay: 1, weekAnchorDate: '', viewMode: 'day' })
    return this.loadSummary()
  },

  onPrevYear() { return this.shiftCalendarYear(-1) },
  onNextYear() { return this.shiftCalendarYear(1) },
  shiftCalendarYear(offset) {
    const year = this.data.year + offset
    if (year < 1970 || year > 2099) return
    const selectedDay = Math.min(this.data.selectedDay, new Date(year, this.data.month, 0).getDate())
    this._dayRequestVersion = (this._dayRequestVersion || 0) + 1
    this.setData({ year, selectedDay, viewMode: 'month', weekAnchorDate: '', dayLoading: false })
    return this.loadSummary()
  },

  onMonthTap(e) {
    const month = Number(e.currentTarget.dataset.month)
    if (!Number.isInteger(month) || month < 1 || month > 12) return
    const now = new Date()
    const isCurrentMonth = this.data.year === now.getFullYear() && month === now.getMonth() + 1
    const preferredDay = month === this.data.month ? this.data.selectedDay : isCurrentMonth ? now.getDate() : 1
    const selectedDay = Math.min(preferredDay, new Date(this.data.year, month, 0).getDate())
    this.setData({ month, selectedDay, viewMode: 'day', weekAnchorDate: '' })
    return this.loadSummary()
  },

  onRetryDay() { return this.buildDayRecords(this.data.selectedDay) },
  onRetryCalendar() { return this.loadSummary() },

  onOpenWeekPicker() {
    this.cancelWeekChartDraw()
    const anchor = parseLocalDate(this.data.weekAnchorDate)
      || new Date(this.data.year, this.data.month - 1, this.data.selectedDay, 12)
    this.updateWeekPickerMonth(anchor.getFullYear(), anchor.getMonth() + 1)
    this.setData({ showWeekPicker: true })
  },

  onCloseWeekPicker() {
    this.setData({ showWeekPicker: false }, () => this.scheduleWeekChart())
  },
  onWeekPickerContentTap() {},

  updateWeekPickerMonth(year, month) {
    const selectedWeek = this.getSelectedWeek()
    this.setData({
      weekPickerYear: year, weekPickerMonth: month,
      weekPickerMonthValue: `${year}-${String(month).padStart(2, '0')}`,
      weekPickerOptions: getMonthWeeks(year, month, selectedWeek.startDate)
    })
  },

  shiftWeekPickerMonth(offset) {
    const month = new Date(this.data.weekPickerYear, this.data.weekPickerMonth - 1 + offset, 1, 12)
    if (month.getFullYear() < 1970 || month.getFullYear() > 2099) return
    this.updateWeekPickerMonth(month.getFullYear(), month.getMonth() + 1)
  },
  onPrevWeekPickerMonth() { this.shiftWeekPickerMonth(-1) },
  onNextWeekPickerMonth() { this.shiftWeekPickerMonth(1) },

  onWeekPickerMonthChange(e) {
    const match = /^(\d{4})-(\d{2})$/.exec(e.detail.value || '')
    if (!match) return
    const year = Number(match[1])
    const month = Number(match[2])
    if (year < 1970 || year > 2099 || month < 1 || month > 12) return
    this.updateWeekPickerMonth(year, month)
  },

  onSelectWeek(e) {
    const startDate = e.currentTarget.dataset.start
    const option = this.data.weekPickerOptions.find((week) => week.startDate === startDate)
    if (!option) return
    const previousWeek = this.getSelectedWeek()
    const reload = previousWeek.startDate !== option.startDate || this.data.weekLoadFailed
    this.setData({ weekAnchorDate: option.startDate, showWeekPicker: false }, () => {
      if (!reload) this.scheduleWeekChart()
    })
    if (reload) return this.loadSummary()
  },

  onFollowCalendarWeek() {
    const previousWeek = this.getSelectedWeek()
    const calendarWeek = getNaturalWeek(this.data.year, this.data.month, this.data.selectedDay)
    const reload = previousWeek.startDate !== calendarWeek.startDate || this.data.weekLoadFailed
    this.setData({ weekAnchorDate: '', showWeekPicker: false }, () => {
      if (!reload) this.scheduleWeekChart()
    })
    if (reload) return this.loadSummary()
  },

  onRetryWeek() { return this.loadSummary() },

  cancelWeekChartDraw() {
    this._chartDrawVersion = (this._chartDrawVersion || 0) + 1
    if (this._chartDrawTimer) {
      clearTimeout(this._chartDrawTimer)
      this._chartDrawTimer = null
    }
  },

  /** 等 setData 和 wx:if 完成布局后再测量 Canvas，并使旧绘制任务失效。 */
  scheduleWeekChart() {
    if (this.data.activeView !== 'glucose' || this.data.loading || this.data.weekLoadFailed || this.data.showWeekPicker) return
    this.cancelWeekChartDraw()
    if (this.data.weekChartError) this.setData({ weekChartError: false })
    const drawVersion = this._chartDrawVersion
    const draw = () => this.drawWeekChart(drawVersion, 0)
    if (typeof wx.nextTick === 'function') wx.nextTick(draw)
    else this._chartDrawTimer = setTimeout(draw, 16)
  },

  /** 周曲线：保留每天的横轴位置，并按日期连接实际记录点。 */
  drawWeekChart(drawVersion, attempt) {
    if (drawVersion !== this._chartDrawVersion || this.data.activeView !== 'glucose'
      || this.data.showWeekPicker || this.data.loading || this.data.weekLoadFailed) return

    const points = (this.data.weekPoints || []).map((point) => {
      const value = point.value == null || point.value === '' ? null : Number(point.value)
      return { ...point, value: Number.isFinite(value) ? value : null }
    })
    const labels = points.map((p) => p.label)
    const brand = getTheme(getDisplaySettings().theme).brand

    const query = wx.createSelectorQuery()
    query.select('#weekChart').fields({ node: true, size: true }).exec((res) => {
      if (drawVersion !== this._chartDrawVersion || this.data.activeView !== 'glucose'
        || this.data.showWeekPicker || this.data.loading || this.data.weekLoadFailed) return
      if (!res[0] || !res[0].node || res[0].width <= 0 || res[0].height <= 0) {
        if (attempt < 4) {
          this._chartDrawTimer = setTimeout(() => this.drawWeekChart(drawVersion, attempt + 1), 50)
        } else {
          this.setData({ weekChartError: true })
        }
        return
      }
      if (this.data.weekChartError) this.setData({ weekChartError: false })
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

        // 跳过无记录日，按日期顺序连接已有值；稀疏数据也能形成可见趋势。
        ctx.strokeStyle = brand
        ctx.lineWidth = 2.5
        const valuedPoints = []
        points.forEach((p, i) => {
          if (p.value != null) valuedPoints.push(toPoint(p.value, i))
        })
        if (valuedPoints.length > 1) {
          ctx.beginPath()
          valuedPoints.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y)
            else ctx.lineTo(point.x, point.y)
          })
          ctx.stroke()
        }

        valuedPoints.forEach((point) => {
          ctx.fillStyle = brand
          ctx.beginPath()
          ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
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
    const mode = e.currentTarget.dataset.mode
    if (mode !== 'month' && mode !== 'day') return
    if (mode === this.data.viewMode) return
    if (mode === 'month') {
      this._dayRequestVersion = (this._dayRequestVersion || 0) + 1
      this.setData({ viewMode: mode, dayLoading: false, expandedMealId: '' })
      return
    }
    this.setData({ viewMode: mode }, () => {
      this.buildDayRecords(this.data.selectedDay)
    })
  },

  onDayTap(e) {
    const day = Number(e.currentTarget.dataset.day)
    if (!Number.isInteger(day) || day < 1 || day > new Date(this.data.year, this.data.month, 0).getDate()) return
    const selected = this.data.calendarDays.find((d) => d.day === day)
    this.setData({
      selectedDay: day,
      weekAnchorDate: '',
      selectedCount: selected ? selected.count : 0,
      viewMode: 'day'
    }, () => this.loadSummary())
  },

  onPrevDay() {
    this.shiftSelectedDay(-1)
  },

  onNextDay() {
    this.shiftSelectedDay(1)
  },

  shiftSelectedDay(offset) {
    const date = new Date(this.data.year, this.data.month - 1, this.data.selectedDay)
    date.setDate(date.getDate() + offset)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const selectedDay = date.getDate()
    this.setData({ year, month, selectedDay, viewMode: 'day', weekAnchorDate: '' }, () => {
      this.loadSummary()
    })
  },

  onExport() {
    wx.navigateTo({ url: '/pages/export-data/export-data' })
  },

  onGoAi() {
    wx.switchTab({ url: '/pages/ai/ai' })
  }
})
