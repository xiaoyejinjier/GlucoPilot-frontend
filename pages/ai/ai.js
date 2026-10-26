const { GLUCOSE_NODES, getGlucoseStatus } = require('../../utils/constants')
const { t } = require('../../utils/locales/en')
const { fetchDayBoard, fetchDayMeals, fetchGlucoseRecords } = require('../../services/api')
const { getToken } = require('../../utils/request')
const { getTodayKey, getRecords, replaceDayRecords } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')
const { getNodeRecordWindow, getRecordWindowHint } = require('../../utils/record-window')
const { hasMeasuredGlucose, getRecommendedPrediction, getChartPointDetails, drawPredictionSeries,
  PREDICTION_COLOR, getTouchPosition, findChartPoint } = require('../../utils/glucose-chart')

const HUNGER_LEVEL_TEXT = ['', '饱腹', '一般', '微饿']

function gesturePosition(touch) {
  return getTouchPosition(touch) || (touch && Number.isFinite(touch.clientX) && Number.isFinite(touch.clientY)
    ? { x: touch.clientX, y: touch.clientY } : null)
}

function settled(promise) {
  return promise
    .then((value) => ({ value }))
    .catch((error) => ({ error }))
}

Page({
  data: {
    displayStyle: '',
    nodes: [],
    recordCount: 0,
    /** 只统计三个餐前、三个餐后的实测节点。 */
    glucoseTotalNodes: 6,
    timeRuleHint: '',
    selectedChartNodeId: '',
    chartSelection: null,
    noticeVisible: false,
    navigationGuideVisible: false
  },

  onShow() {
    this._visible = true
    const app = getApp()
    if (typeof app.checkLogin === 'function' && !app.checkLogin()) { this._visible = false; return }
    this.setData({ navigationGuideVisible: !!(app.getNavigationGuideToken && app.getNavigationGuideToken()) })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
      if (this.getTabBar().refreshGuide) this.getTabBar().refreshGuide()
    }
    applyDisplayToCurrentPage()
    // 先用本地缓存立即渲染，再用数据库中的当天记录校准页面。
    this.loadData()
    this.syncTodayFromServer()
    this.startRecordWindowTimer()
  },

  onReady() {
    if (this.getTabBar && this.getTabBar() && this.getTabBar().refreshGuide) this.getTabBar().refreshGuide()
    this.scheduleChartDraw(this.data.nodes)
  },

  onNavigationGuideComplete() {
    this.setData({ navigationGuideVisible: false }, () => this.scheduleChartDraw(this.data.nodes))
  },

  onHide() {
    this._visible = false
    this._syncVersion = (this._syncVersion || 0) + 1
    this._chartGeometry = null
    this._chartTouch = null
    this.stopRecordWindowTimer()
    this.cancelChartDraw()
  },

  onUnload() {
    this._visible = false
    this._syncVersion = (this._syncVersion || 0) + 1
    this._chartGeometry = null
    this._chartTouch = null
    this.stopRecordWindowTimer()
    this.cancelChartDraw()
  },

  onResize() {
    this.scheduleChartDraw(this.data.nodes)
  },

  onAddDevice() { wx.navigateTo({ url: '/pages/device-add/device-add' }) },

  onOpenStats() {
    if (this._openingStats) return
    this._openingStats = true
    wx.navigateTo({ url: '/pages/stats/stats', complete: () => { this._openingStats = false } })
  },

  onReminderVisibilityChange(e) {
    const visible = !!e.detail.visible
    this._chartGeometry = null
    this._chartTouch = null
    this._chartTapVersion = (this._chartTapVersion || 0) + 1
    this.cancelChartDraw()
    this.setData({ noticeVisible: visible }, () => {
      if (!visible && this._visible !== false) this.scheduleChartDraw(this.data.nodes)
    })
  },

  syncTodayFromServer() {
    const token = getToken()
    if (!token) return

    const recordDate = getTodayKey()
    const syncVersion = (this._syncVersion || 0) + 1
    this._syncVersion = syncVersion
    return Promise.all([
      settled(fetchDayBoard(recordDate)),
      settled(fetchDayMeals(recordDate)),
      settled(fetchGlucoseRecords({ startDate: recordDate, endDate: recordDate, pageSize: 100 }))
    ])
      .then(([boardResult, mealResult, glucoseResult]) => {
        if (syncVersion !== this._syncVersion || this._visible === false || recordDate !== getTodayKey() || getToken() !== token) return
        const cached = getRecords(recordDate)
        const records = { ...cached }

        // 两类接口分别覆盖自己的节点；其中一个接口失败时，另一类缓存仍可保留并展示。
        if (glucoseResult.value && Array.isArray(glucoseResult.value.records)) {
          GLUCOSE_NODES.filter((node) => !node.isMeal).forEach((node) => delete records[node.id])
          glucoseResult.value.records.forEach((record) => {
            const node = GLUCOSE_NODES.find((item) => item.id === record.nodeCode && !item.isMeal)
            if (!node || (record.recordDate && record.recordDate !== recordDate)) return
            records[node.id] = { id: record.id, value: record.value, type: 'glucose',
              recordedAt: record.recordedAt || '', sourceType: record.sourceType,
              remark: record.remark || '' }
          })
        } else if (boardResult.value) {
          GLUCOSE_NODES.filter((node) => !node.isMeal).forEach((node) => delete records[node.id])
          ;(boardResult.value.nodes || []).forEach((node) => {
            if (!node.hasRecord || node.isMeal) return
            const id = node.nodeCode || node.id
            const previous = cached[id]
            const sameValue = previous && previous.type === 'glucose' && Number(previous.value) === Number(node.value)
            records[id] = {
              value: node.value,
              type: node.recordKind || 'glucose',
              remark: node.remark || '',
              recordedAt: sameValue ? previous.recordedAt || '' : '',
              sourceType: node.sourceType || (sameValue ? previous.sourceType : undefined)
            }
          })
        }

        if (mealResult.value) {
          GLUCOSE_NODES.filter((node) => node.isMeal).forEach((node) => delete records[node.id])
          ;(mealResult.value.meals || []).forEach((meal) => {
            records[meal.nodeCode] = {
              id: meal.id,
              type: 'meal',
              foods: meal.foodsText || '',
              carbs: meal.carbsG,
              hunger: HUNGER_LEVEL_TEXT[meal.hungerLevel] || '',
              predictedGlucose: meal.predictNow,
              suggestedGlucose: meal.predictSuggest,
              supplement: meal.supplementText || '',
              imageUrl: meal.mediaUrl || ''
            }
          })
        }

        replaceDayRecords(recordDate, records)
        this.loadData()

        const errors = [boardResult.error, mealResult.error, glucoseResult.error].filter(Boolean)
        errors.forEach((err) => {
          // 网络异常时继续展示对应类型的本地缓存；登录失效由统一请求层处理。
          if (err && err.code !== 40100) {
            console.warn('同步今日记录失败', err)
          }
        })
      })
      .catch((err) => {
        if (err && err.code !== 40100) {
          console.warn('合并今日记录失败', err)
        }
      })
  },

  loadData() {
    const records = getRecords()
    this._displayRecordDate = getTodayKey()
    this._chartTapVersion = (this._chartTapVersion || 0) + 1
    this._chartTouch = null
    const now = new Date()
    const nodes = GLUCOSE_NODES.map(n => {
      const rec = records[n.id]
      // 三个正餐独立保存推荐预测，不进入六个实测节点的进度。
      const value = !n.isMeal && rec && rec.value != null ? rec.value : null
      return {
        ...n,
        ...getNodeRecordWindow(n.id, now),
        value,
        predictionValue: n.isMeal && rec ? rec.suggestedGlucose : null,
        recordedAt: rec ? rec.recordedAt || '' : '',
        sourceType: rec ? rec.sourceType : undefined,
        remark: rec ? rec.remark || '' : '',
        status: getGlucoseStatus(value),
        hasRecord: !!rec
      }
    })
    const selected = nodes.find((node) => node.id === this.data.selectedChartNodeId)
    const chartSelection = getChartPointDetails(selected)
    this.setData({
      nodes,
      chartSelection,
      selectedChartNodeId: chartSelection ? chartSelection.nodeId : '',
      recordCount: nodes.filter(hasMeasuredGlucose).length,
      glucoseTotalNodes: 6,
      timeRuleHint: getRecordWindowHint(now)
    })
    // 等 setData 与页面布局都稳定后再绘制，避免首次进入时 Canvas 尺寸错位。
    this.scheduleChartDraw(nodes)
  },

  scheduleChartDraw(nodes) {
    if (this._visible === false || this.data.noticeVisible || this.data.navigationGuideVisible) return
    this._chartGeometry = null
    this._pendingChartNodes = nodes || []
    this.cancelChartDraw()
    const drawVersion = (this._chartDrawVersion || 0) + 1
    this._chartDrawVersion = drawVersion
    wx.nextTick(() => {
      if (drawVersion !== this._chartDrawVersion) return
      this._chartDrawTimer = setTimeout(() => {
        if (drawVersion !== this._chartDrawVersion) return
        this._chartDrawTimer = null
        this.drawChart(this._pendingChartNodes || this.data.nodes || [], drawVersion)
      }, 60)
    })
  },

  cancelChartDraw() {
    this._chartDrawVersion = (this._chartDrawVersion || 0) + 1
    if (this._chartDrawTimer) {
      clearTimeout(this._chartDrawTimer)
      this._chartDrawTimer = null
    }
  },

  startRecordWindowTimer() {
    this.stopRecordWindowTimer()
    this._recordWindowTimer = setInterval(() => this.refreshRecordWindows(), 30000)
  },

  stopRecordWindowTimer() {
    if (this._recordWindowTimer) {
      clearInterval(this._recordWindowTimer)
      this._recordWindowTimer = null
    }
  },

  refreshRecordWindows() {
    if (this._displayRecordDate !== getTodayKey()) {
      this.loadData()
      this.syncTodayFromServer()
      return
    }
    const now = new Date()
    this.setData({
      nodes: (this.data.nodes || []).map((node) => ({
        ...node,
        ...getNodeRecordWindow(node.id, now)
      })),
      timeRuleHint: getRecordWindowHint(now)
    })
  },

  drawChart(nodes, drawVersion = this._chartDrawVersion) {
    if (drawVersion !== this._chartDrawVersion || this._visible === false || this.data.noticeVisible || this.data.navigationGuideVisible) return
    const query = wx.createSelectorQuery().in(this)
    query.select('#glucoseChart').fields({ node: true, size: true }).exec(res => {
      if (drawVersion !== this._chartDrawVersion || this._visible === false || this.data.noticeVisible || this.data.navigationGuideVisible) return
      if (!res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio
      const width = res[0].width
      const height = res[0].height
      if (!width || !height) return
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)

      // 左侧为 Y 轴数值留空间，右侧避免最后一个中文标签被 Canvas 裁掉。
      const padding = { left: 42, right: 24, top: 28, bottom: 26 }
      const chartW = width - padding.left - padding.right
      const chartH = height - padding.top - padding.bottom
      if (chartW <= 0 || chartH <= 0) return

      ctx.clearRect(0, 0, width, height)

      // 坐标轴
      ctx.strokeStyle = '#ddd'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padding.left, padding.top)
      ctx.lineTo(padding.left, padding.top + chartH)
      ctx.lineTo(padding.left + chartW, padding.top + chartH)
      ctx.stroke()

      const measuredNodes = nodes.filter((node) => !node.isMeal)
      const mealNodes = nodes.filter((node) => getRecommendedPrediction(node) != null)
      const count = measuredNodes.length || 6
      const stepX = count > 1 ? chartW / (count - 1) : 0
      const glucoseValues = nodes
        .filter(hasMeasuredGlucose)
        .map((node) => Number(node.value))
        .concat(mealNodes.map(getRecommendedPrediction))
      const smallestValue = glucoseValues.length ? Math.min(...glucoseValues) : 3
      const largestValue = glucoseValues.length ? Math.max(...glucoseValues) : 12
      const minY = smallestValue < 3 ? 0 : 3
      let tickStep = 3
      if (largestValue > 21) tickStep = 6
      if (largestValue > 33) tickStep = 9
      const maxY = Math.max(12, minY + Math.ceil((largestValue - minY) / tickStep) * tickStep)
      const yTicks = []
      for (let value = minY; value <= maxY; value += tickStep) yTicks.push(value)

      // 单位置于纵轴最高刻度正上方，预留顶部空间，避免占用图表下方两行。
      ctx.font = '10px sans-serif'
      ctx.fillStyle = '#888'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('mmol/L', padding.left - 12, padding.top - 10)

      // Y 轴刻度与数值
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      yTicks.forEach((val) => {
        const y = padding.top + chartH - ((val - minY) / (maxY - minY)) * chartH
        ctx.strokeStyle = '#eee'
        ctx.beginPath()
        ctx.moveTo(padding.left, y)
        ctx.lineTo(padding.left + chartW, y)
        ctx.stroke()
        ctx.fillStyle = '#888'
        ctx.fillText(String(val), padding.left - 6, y)
      })

      // 六个实测横轴；正餐预测位于对应的餐后位置。
      const allPoints = measuredNodes.map((n, i) => {
        const x = padding.left + i * stepX
        const numericValue = Number(n.value)
        const has = hasMeasuredGlucose(n)
        const plottedValue = Math.max(minY, Math.min(maxY, numericValue))
        const y = has
          ? padding.top + chartH - ((plottedValue - minY) / (maxY - minY)) * chartH
          : padding.top + chartH * 0.55
        return { x, y, has, nodeId: n.id, isMeal: n.isMeal,
          value: has ? numericValue : null, status: n.status, short: n.short }
      })
      const predictionPoints = mealNodes.map((node) => {
        const target = allPoints.find((point) => point.nodeId === 'after_' + node.id)
        if (!target) return null
        const value = getRecommendedPrediction(node)
        return { x: target.x, y: padding.top + chartH - ((value - minY) / (maxY - minY)) * chartH,
          has: true, nodeId: node.id, value, isPrediction: true }
      }).filter(Boolean)
      this._chartGeometry = { width, height, points: allPoints, predictionPoints }
      drawPredictionSeries(ctx, predictionPoints)

      // 折线只连接有值点
      const valued = allPoints.filter(p => p.has)
      const brand = getTheme(getDisplaySettings().theme).brand
      if (valued.length > 1) {
        ctx.strokeStyle = brand
        ctx.lineWidth = 2.5
        ctx.beginPath()
        valued.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()
      }

      const colors = { ok: brand, warn: '#fa9d3b', danger: '#fa5151', empty: '#c8c8c8' }
      allPoints.forEach(p => {
        if (p.has) {
          ctx.fillStyle = colors[p.status] || brand
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // 缺测位置使用灰色占位，预测值不会被当成实测。
          if (predictionPoints.some((point) => point.x === p.x)) return
          ctx.strokeStyle = '#c8c8c8'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      })

      const selected = valued.concat(predictionPoints).find((point) => point.nodeId === this.data.selectedChartNodeId)
      if (selected) {
        ctx.strokeStyle = selected.isPrediction ? PREDICTION_COLOR : colors[selected.status] || brand
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(selected.x, selected.y, 8, 0, Math.PI * 2)
        ctx.stroke()
      }

      // X 轴六个餐前/餐后标签全显示。
      ctx.fillStyle = '#888'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      allPoints.forEach(p => {
        ctx.fillText(t(p.short, this.data.locale), p.x, height - 8)
      })
    })
  },

  onChartTouchStart(e) {
    this._chartTapVersion = (this._chartTapVersion || 0) + 1
    const touches = e.touches || []
    const position = touches.length === 1 ? gesturePosition(touches[0]) : null
    this._chartTouch = position ? { position, moved: false } : null
  },

  onChartTouchMove(e) {
    if (!this._chartTouch) return
    const touches = e.touches || []
    const position = touches.length === 1 ? gesturePosition(touches[0]) : null
    if (!position || Math.hypot(position.x - this._chartTouch.position.x,
      position.y - this._chartTouch.position.y) > 12) this._chartTouch.moved = true
  },

  onChartTouchCancel() { this._chartTouch = null },

  onChartTouchEnd(e) {
    const gesture = this._chartTouch
    this._chartTouch = null
    const touches = e.changedTouches || []
    const touch = touches.length === 1 ? touches[0] : null
    const finalPosition = gesturePosition(touch)
    const geometry = this._chartGeometry
    if (!gesture || gesture.moved || !geometry || !finalPosition || this._visible === false
      || Math.hypot(finalPosition.x - gesture.position.x, finalPosition.y - gesture.position.y) > 12) return
    const position = getTouchPosition(touch)
    if (position) { this.selectChartPoint(position, geometry); return }
    const tapVersion = this._chartTapVersion
    wx.createSelectorQuery().in(this).select('#glucoseChart').boundingClientRect().exec((result) => {
      if (tapVersion !== this._chartTapVersion || geometry !== this._chartGeometry || this._visible === false) return
      this.selectChartPoint(getTouchPosition(touch, result[0], geometry), geometry)
    })
  },

  selectChartPoint(position, geometry) {
    if (geometry !== this._chartGeometry || this._visible === false || !position) return
    // 重合时优先选实测，预测也能查看明确标注的推荐依据。
    const point = findChartPoint((geometry.predictionPoints || []).concat(geometry.points.filter((p) => p.has)), position)
      || findChartPoint(geometry.points, position)
    if (!point || !point.has) {
      this.onCloseChartDetails()
      if (point) wx.showToast({ title: '该时段暂无实测血糖', icon: 'none' })
      return
    }
    const node = this.data.nodes.find((item) => item.id === point.nodeId)
    const details = getChartPointDetails(node)
    if (!details) return
    if (this.data.chartSelection && this.data.selectedChartNodeId === point.nodeId) {
      this.onCloseChartDetails()
      return
    }
    this.setData({ selectedChartNodeId: point.nodeId, chartSelection: details }, () => {
      this.scheduleChartDraw(this.data.nodes)
    })
  },

  onCloseChartDetails() {
    this._chartTapVersion = (this._chartTapVersion || 0) + 1
    this.setData({ selectedChartNodeId: '', chartSelection: null }, () => this.scheduleChartDraw(this.data.nodes))
  },

  onNodeTap(e) {
    const { id } = e.currentTarget.dataset
    const node = GLUCOSE_NODES.find(n => n.id === id)
    const recordWindow = getNodeRecordWindow(id, new Date())
    if (recordWindow.locked) {
      this.refreshRecordWindows()
      wx.showModal({
        title: '该时段已截止',
        content: recordWindow.lockReason,
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    const isMeal = !!(node && node.isMeal)
    wx.navigateTo({
      url: `/pages/camera/camera?nodeId=${id}&isMeal=${isMeal ? 1 : 0}&nodeName=${encodeURIComponent(node ? node.name : '')}`
    })
  }
})
