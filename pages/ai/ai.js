const { GLUCOSE_NODES, getGlucoseStatus } = require('../../utils/constants')
const { fetchDayBoard } = require('../../services/api')
const { getToken } = require('../../utils/request')
const { getTodayKey, getRecords, getRecordCount, replaceDayRecords } = require('../../utils/storage')
const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    nodes: [],
    recordCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    applyDisplayToCurrentPage()
    // 先用本地缓存立即渲染，再用数据库中的当天记录校准页面。
    this.loadData()
    this.syncTodayFromServer()
  },

  syncTodayFromServer() {
    if (!getToken()) return

    const recordDate = getTodayKey()
    fetchDayBoard(recordDate)
      .then((board) => {
        const records = {}
        ;(board.nodes || []).forEach((node) => {
          if (!node.hasRecord) return
          records[node.nodeCode || node.id] = {
            value: node.value,
            type: node.recordKind || 'glucose',
            remark: node.remark || ''
          }
        })
        replaceDayRecords(recordDate, records)
        this.loadData()
      })
      .catch((err) => {
        // 网络异常时继续展示本地缓存；登录失效由统一请求层处理。
        if (err && err.code !== 40100) {
          console.warn('同步今日血糖记录失败', err)
        }
      })
  },

  loadData() {
    const records = getRecords()
    const nodes = GLUCOSE_NODES.map(n => {
      const rec = records[n.id]
      // 餐点记录可能没有 value，有 meal 数据也算已记
      let value = null
      if (rec) {
        if (rec.value != null) value = rec.value
        else if (rec.type === 'meal' && rec.suggestedGlucose != null) value = rec.suggestedGlucose
      }
      return {
        ...n,
        value,
        status: getGlucoseStatus(value),
        hasRecord: !!rec
      }
    })
    this.setData({
      nodes,
      recordCount: getRecordCount(records)
    })
    // 延后绘制，避免与 setData 抢主线程造成卡顿感
    setTimeout(() => this.drawChart(nodes), 30)
  },

  drawChart(nodes) {
    const query = wx.createSelectorQuery()
    query.select('#glucoseChart').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio
      const width = res[0].width
      const height = res[0].height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)

      const padding = { left: 40, right: 12, top: 14, bottom: 30 }
      const chartW = width - padding.left - padding.right
      const chartH = height - padding.top - padding.bottom

      ctx.clearRect(0, 0, width, height)

      // 坐标轴
      ctx.strokeStyle = '#ddd'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padding.left, padding.top)
      ctx.lineTo(padding.left, padding.top + chartH)
      ctx.lineTo(padding.left + chartW, padding.top + chartH)
      ctx.stroke()

      const count = nodes.length || 9
      const stepX = count > 1 ? chartW / (count - 1) : 0
      const minY = 3
      const maxY = 12
      const yTicks = [3, 6, 9, 12]

      // Y 轴刻度与数值
      ctx.font = '10px sans-serif'
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

      // 固定 9 个 X 轴位置（有无值都画）
      const allPoints = nodes.map((n, i) => {
        const x = padding.left + i * stepX
        const has = n.value != null && n.value !== ''
        const y = has
          ? padding.top + chartH - ((n.value - minY) / (maxY - minY)) * chartH
          : padding.top + chartH * 0.55
        return { x, y, has, value: n.value, status: n.status, short: n.short }
      })

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
          ctx.fillStyle = colors[p.status] || '#07c160'
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // 未记录：灰色空心点，占满 9 时段视觉
          ctx.strokeStyle = '#c8c8c8'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      })

      // X 轴 9 时段标签全显示
      ctx.fillStyle = '#888'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      allPoints.forEach(p => {
        ctx.fillText(p.short, p.x, height - 8)
      })
    })
  },

  onNodeTap(e) {
    const { id } = e.currentTarget.dataset
    const node = GLUCOSE_NODES.find(n => n.id === id)
    const isMeal = !!(node && node.isMeal)
    wx.navigateTo({
      url: `/pages/camera/camera?nodeId=${id}&isMeal=${isMeal ? 1 : 0}&nodeName=${encodeURIComponent(node ? node.name : '')}`
    })
  }
})
