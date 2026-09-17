const { applyDisplayToCurrentPage } = require('../../utils/display')

const ITEM_RPX = 72
const VISIBLE = 5 // 上下各 2 + 中间 1

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function buildMonths() {
  const list = []
  for (let i = 1; i <= 12; i++) list.push(i)
  return list
}

function buildDays(year, month) {
  const n = daysInMonth(year, month)
  const list = []
  for (let i = 1; i <= n; i++) list.push(i)
  return list
}

function formatDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function itemPx() {
  const w = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || wx.getSystemInfoSync().windowWidth
  return (ITEM_RPX * w) / 750
}

Page({
  data: {
    displayStyle: '',
    ranges: [
      { id: '7', label: '近 7 天' },
      { id: '30', label: '近 30 天' },
      { id: 'custom', label: '自定义' }
    ],
    activeRange: '7',
    rangeLabel: '近 7 天',
    previewCount: 0,
    exportText: '',
    filePath: '',
    exporting: false,

    showDateSheet: false,
    dateStep: 'start',
    pickYear: 2026,
    months: buildMonths(),
    days: buildDays(2026, 9),
    monthIndex: 8,
    dayIndex: 0,
    monthScrollTop: 0,
    dayScrollTop: 0,
    customStart: '',
    customEnd: ''
  },

  _itemH: 36,
  _padCount: 2,

  onLoad() {
    this._itemH = itemPx()
    this._padCount = Math.floor(VISIBLE / 2)
    this.refreshPreview()
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  onBack() {
    wx.navigateBack()
  },

  onRange(e) {
    const id = e.currentTarget.dataset.id
    if (id === 'custom') {
      this.openCustomPicker()
      return
    }
    const item = this.data.ranges.find(r => r.id === id)
    this.setData({
      activeRange: id,
      rangeLabel: item ? item.label : id,
      customStart: '',
      customEnd: ''
    })
    this.refreshPreview()
  },

  syncScroll(mIdx, dIdx) {
    const h = this._itemH || itemPx()
    this._itemH = h
    // 先清零再设，确保 scroll-top 生效
    this.setData({ monthScrollTop: 0, dayScrollTop: 0 }, () => {
      this.setData({
        monthIndex: mIdx,
        dayIndex: dIdx,
        monthScrollTop: mIdx * h,
        dayScrollTop: dIdx * h
      })
    })
  },

  openCustomPicker() {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const d = now.getDate()
    this.setData({
      showDateSheet: true,
      dateStep: 'start',
      pickYear: y,
      months: buildMonths(),
      days: buildDays(y, m),
      activeRange: 'custom'
    })
    this.syncScroll(m - 1, d - 1)
  },

  onReopenStart() {
    this.openPickerAt('start', this.data.customStart)
  },

  onReopenEnd() {
    this.openPickerAt('end', this.data.customEnd || this.data.customStart)
  },

  openPickerAt(step, dateStr) {
    const now = new Date()
    let y = now.getFullYear()
    let m = now.getMonth() + 1
    let d = now.getDate()
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.split('-').map(Number)
      y = parts[0]
      m = parts[1]
      d = parts[2]
    }
    const maxD = daysInMonth(y, m)
    const dIdx = Math.min(d, maxD) - 1
    this.setData({
      showDateSheet: true,
      dateStep: step,
      pickYear: y,
      months: buildMonths(),
      days: buildDays(y, m),
      activeRange: 'custom'
    })
    this.syncScroll(m - 1, dIdx)
  },

  onCloseSheet() {
    this.setData({ showDateSheet: false })
    if (this.data.activeRange === 'custom' && !this.data.customStart) {
      this.setData({
        activeRange: '7',
        rangeLabel: '近 7 天'
      })
      this.refreshPreview()
    }
  },

  onPrevYear() {
    this.updateYear(this.data.pickYear - 1)
  },

  onNextYear() {
    this.updateYear(this.data.pickYear + 1)
  },

  updateYear(y) {
    const m = this.data.months[this.data.monthIndex] || 1
    let dIdx = this.data.dayIndex || 0
    const days = buildDays(y, m)
    if (dIdx >= days.length) dIdx = days.length - 1
    this.setData({ pickYear: y, days })
    this.syncScroll(m - 1, dIdx)
  },

  onMonthScroll(e) {
    this._monthTop = e.detail.scrollTop
    clearTimeout(this._monthTimer)
    this._monthTimer = setTimeout(() => this.snapMonth(), 60)
  },

  onDayScroll(e) {
    this._dayTop = e.detail.scrollTop
    clearTimeout(this._dayTimer)
    this._dayTimer = setTimeout(() => this.snapDay(), 60)
  },

  snapMonth() {
    const h = this._itemH || itemPx()
    let idx = Math.round((this._monthTop || 0) / h)
    idx = Math.max(0, Math.min(11, idx))
    const m = idx + 1
    const days = buildDays(this.data.pickYear, m)
    let dIdx = this.data.dayIndex
    if (dIdx >= days.length) dIdx = days.length - 1
    this.setData({
      monthIndex: idx,
      days,
      monthScrollTop: idx * h,
      dayIndex: dIdx,
      dayScrollTop: dIdx * h
    })
  },

  snapDay() {
    const h = this._itemH || itemPx()
    const max = (this.data.days || []).length - 1
    let idx = Math.round((this._dayTop || 0) / h)
    idx = Math.max(0, Math.min(max, idx))
    this.setData({
      dayIndex: idx,
      dayScrollTop: idx * h
    })
  },

  onConfirmDate() {
    const { pickYear, months, days, monthIndex, dayIndex, dateStep } = this.data
    const m = months[monthIndex]
    const d = days[dayIndex] || 1
    const dateStr = formatDate(pickYear, m, d)

    if (dateStep === 'start') {
      this.setData({
        customStart: dateStr,
        dateStep: 'end'
      })
      wx.showToast({ title: '再选结束日期', icon: 'none' })
      return
    }

    let start = this.data.customStart
    let end = dateStr
    if (start > end) {
      const t = start
      start = end
      end = t
    }

    this.setData({
      showDateSheet: false,
      customStart: start,
      customEnd: end,
      activeRange: 'custom',
      rangeLabel: `${start} ~ ${end}`
    })
    this.refreshPreview()
  },

  refreshPreview() {
    const all = wx.getStorageSync('glucoseRecords') || {}
    let count = 0
    const { activeRange, customStart, customEnd } = this.data

    Object.keys(all).forEach(day => {
      const dayCount = Object.keys(all[day] || {}).length
      if (activeRange === 'custom' && customStart && customEnd) {
        if (day >= customStart && day <= customEnd) count += dayCount
      } else {
        count += dayCount
      }
    })

    if (activeRange !== 'custom') {
      const factor = activeRange === '30' ? 1 : 0.3
      count = Math.max(count, Math.ceil(count * factor) || 3)
    } else if (!count) {
      count = 3
    }

    this.setData({ previewCount: count })
  },

  buildExportText() {
    const all = wx.getStorageSync('glucoseRecords') || {}
    const lines = [`【控糖助手导出】`, `范围：${this.data.rangeLabel}`, `导出时间：${this.formatNow()}`, '']
    let days = Object.keys(all).sort()

    if (this.data.activeRange === 'custom' && this.data.customStart && this.data.customEnd) {
      days = days.filter(d => d >= this.data.customStart && d <= this.data.customEnd)
    } else {
      const take = this.data.activeRange === '30' ? 30 : 7
      days = days.slice(-take)
    }

    days.forEach(day => {
      lines.push(`# ${day}`)
      Object.keys(all[day] || {}).forEach(nodeId => {
        const rec = all[day][nodeId]
        if (rec.value != null) lines.push(`- ${nodeId}: ${rec.value} mmol/L`)
        else if (rec.type === 'meal') lines.push(`- ${nodeId}: 饮食 ${rec.foods || ''}`)
      })
      lines.push('')
    })
    if (lines.length <= 4) {
      lines.push('（暂无本地记录，以下为示例）')
      lines.push('- before_breakfast: 5.8')
      lines.push('- after_breakfast: 7.6')
    }
    return lines.join('\n')
  },

  formatNow() {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  onConfirm() {
    if (this.data.exporting) return
    if (this.data.activeRange === 'custom' && (!this.data.customStart || !this.data.customEnd)) {
      wx.showToast({ title: '请先选择自定义日期', icon: 'none' })
      this.openCustomPicker()
      return
    }

    this.setData({ exporting: true })
    const text = this.buildExportText()
    const stamp = this.formatNow().replace(/[:\s-]/g, '')
    const filePath = `${wx.env.USER_DATA_PATH}/控糖导出_${stamp}.txt`

    const finishOk = (savedPath) => {
      this.setData({
        exportText: text,
        filePath: savedPath || '',
        exporting: false
      })
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已导出并复制', icon: 'none' }),
        fail: () => wx.showToast({ title: '已生成摘要', icon: 'none' })
      })
    }

    try {
      const fs = wx.getFileSystemManager()
      fs.writeFile({
        filePath,
        data: text,
        encoding: 'utf8',
        success: () => finishOk(filePath),
        fail: () => finishOk('')
      })
    } catch (e) {
      finishOk('')
    }
  },

  onCopy() {
    if (!this.data.exportText) return
    wx.setClipboardData({
      data: this.data.exportText,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  },

  noop() {}
})
