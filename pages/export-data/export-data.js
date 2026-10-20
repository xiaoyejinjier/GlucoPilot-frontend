const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')
const social = require('../../utils/community')
const { getToken } = require('../../utils/request')
const { downloadExport } = require('../../utils/export-download')

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
    tasks:[],tasksLoading:false,tasksError:'',downloading:'',

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
    if(!getApp().checkLogin())return
    if(this._communityToken && this._communityToken!==getToken()) { this._exportAttempt=null;this.setData({exportText:'',filePath:'',previewCount:null}) }
    social.begin(this);applyDisplayToCurrentPage();this.setData({exporting:false,downloading:'',tasks:[]});this.loadTasks()
  },
  onHide() {social.end(this);this._taskRun=(this._taskRun||0)+1}, onUnload(){this.onHide()},

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

  refreshPreview() { this.setData({previewCount:null,exportText:'',filePath:''}) },
  async loadTasks() {if(!social.active(this))return;const version=this._communityVersion,run=this._taskRun=(this._taskRun||0)+1;this.setData({tasksLoading:true,tasksError:''});try{const page=await api.fetchExportTasks({pageNum:1,pageSize:20});if(social.active(this,version)&&run===this._taskRun)this.setData({tasks:page.records.map(task=>({...task,statusLabel:{pending:'待生成',processing:'生成中',done:'已完成',failed:'失败'}[task.status]||'待更新'}))})}catch(error){if(social.active(this,version,error)&&run===this._taskRun)this.setData({tasksError:error.message||'导出记录读取失败'})}finally{if(social.active(this,version)&&run===this._taskRun)this.setData({tasksLoading:false})}},
  async onConfirm() {
    if(!social.active(this)||this.data.exporting)return
    const now=new Date(),end=this.data.activeRange==='custom'?this.data.customEnd:formatDate(now.getFullYear(),now.getMonth()+1,now.getDate())
    const startDate=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(this.data.activeRange==='30'?29:6))
    const start=this.data.activeRange==='custom'?this.data.customStart:formatDate(startDate.getFullYear(),startDate.getMonth()+1,startDate.getDate())
    if(!start||!end||start>end)return wx.showToast({title:'请选择有效日期范围',icon:'none'})
    const fingerprint=JSON.stringify([start,end]);if(!this._exportAttempt||this._exportAttempt.fingerprint!==fingerprint)this._exportAttempt={fingerprint,payload:{startDate:start,endDate:end,clientRequestId:social.requestId()}}
    const version=this._communityVersion;this.setData({exporting:true})
    try{const created=await api.createExportTask(this._exportAttempt.payload);if(!social.active(this,version))return;const task=await api.generateExportTask(created.id);if(!social.active(this,version))return;if(task.status!=='done')throw new Error(task.error||'文件生成失败，可稍后重试');this._exportAttempt=null;this.setData({exportText:`${task.startDate} 至 ${task.endDate}\n血糖记录 ${task.glucoseCount} 条\n饮食记录 ${task.mealCount} 条`,previewCount:task.glucoseCount+task.mealCount});wx.showToast({title:'XLSX 文件已生成',icon:'success'});this.loadTasks()}catch(error){social.failure(this,error,version);if(social.active(this,version))this.loadTasks()}finally{if(social.active(this,version))this.setData({exporting:false})}
  },
  async onDownload(e) {const id=String(e.currentTarget.dataset.id);if(!social.active(this)||this.data.downloading)return;const version=this._communityVersion,token=getToken();this.setData({downloading:id});try{const path=await downloadExport(id);if(!social.active(this,version)||token!==getToken())return;wx.openDocument({filePath:path,fileType:'xlsx',showMenu:true,fail:()=>{if(social.active(this,version))wx.showToast({title:'文件已下载，暂时无法打开',icon:'none'})}})}catch(error){social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({downloading:''})}},
  async onRetryTask(e) {if(!social.active(this)||this.data.exporting)return;const version=this._communityVersion;this.setData({exporting:true});try{const task=await api.generateExportTask(e.currentTarget.dataset.id);if(social.active(this,version)){if(task.status!=='done')throw new Error(task.error||'生成失败');this.loadTasks()}}catch(error){social.failure(this,error,version)}finally{if(social.active(this,version))this.setData({exporting:false})}},
  onCopy(){if(this.data.exportText)wx.setClipboardData({data:this.data.exportText})},
  noop() {}
})
