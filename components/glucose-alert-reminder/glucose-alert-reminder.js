const { fetchUserReminders, readUserReminder, readInformationCategory, readAllUserReminders } = require('../../services/api')
const notifications = require('../../utils/message-notifications')
const { getTodayKey } = require('../../utils/storage')
const { getToken } = require('../../utils/request')

function formatTime(value) {
  return typeof value === 'string' ? value.replace('T', ' ').replace(/\.\d+$/, '') : ''
}

Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    socialCounts: { type:Object,value:{},observer(counts) { this.setData({ socialTotal:Number(counts && counts.total)||0, socialItems:[{key:'messages',title:'私信'},{key:'likes',title:'点赞'},{key:'collections',title:'收藏'},{key:'comments',title:'评论'},{key:'follows',title:'新关注我的'},{key:'reports',title:'举报反馈'}].map(item=>({...item,count:Math.max(0,Number(counts && counts[item.key])||0)})).filter(item=>item.count>0) }) } },
    nodes: { type: Array, value: [], observer() { if (this._receiptLoaded && this._alive && this._visible) this.refreshReplies() } }
  },
  data: { alerts: [], replies: [], noticeVisible: false, replyTotal: 0, repliesLoading: false, repliesError: '', hasMoreReplies: false, socialTotal:0,socialItems:[], reading:'', informationReading:'', allReading:false },
  lifetimes: {
    attached() { this._alive = true; this._visible = true; this.refreshReplies() },
    detached() { this._alive = false; this._replyVersion = (this._replyVersion || 0) + 1 }
  },
  pageLifetimes: {
    show() { this._visible = true; this.refreshReplies() },
    hide() {
      this._visible = false
      this._receiptLoaded = false
      this.closeNotice()
      this._replyVersion = (this._replyVersion || 0) + 1
      this._replyPending = false
      this.setData({ alerts: [], replies: [], replyTotal: 0, repliesLoading: false, repliesError: '', hasMoreReplies: false, reading:'', informationReading:'' })
    }
  },
  methods: {
    onInformation(e) { if(this.data.allReading)return; this.closeNotice(); const key=e.currentTarget.dataset.key;wx.navigateTo({url:key==='reports'?'/pages/community-reports/community-reports':`/pages/information/information?tab=${key}`}) },
    openNotice() {
      if (!this._alive || !this._visible || this.data.noticeVisible) return
      this.setData({ noticeVisible: true })
      this.triggerEvent('visibilitychange', { visible: true })
    },
    closeNotice() {
      if (!this.data.noticeVisible) return
      this.setData({ noticeVisible: false })
      this.triggerEvent('visibilitychange', { visible: false })
    },
    onNoticeContentTap() {},
    async onReadAll() {
      if (!this._alive || !this._visible || this.data.allReading || this.data.reading || this.data.informationReading) return
      const token = getToken()
      if (!token) return
      this.setData({ allReading: true })
      try {
        await readAllUserReminders(getTodayKey())
        if (getToken() !== token || !this._alive) return
        this._replyVersion = (this._replyVersion || 0) + 1
        this._replyPending = false
        await Promise.all([notifications.refresh(true), this._visible ? this.refreshReplies() : Promise.resolve()])
        if (getToken() === token && this._alive && this._visible) wx.showToast({ title:'已全部标为已读',icon:'none' })
      } catch (error) {
        if (getToken() === token && this._alive && this._visible) wx.showToast({title:error.message || '标记失败，请重试',icon:'none'})
      } finally {
        if (getToken() === token && this._alive) this.setData({allReading:false})
      }
    },
    onOpenReminder(e) {
      const { kind, id } = e.currentTarget.dataset
      const item = (kind === 'GLUCOSE' ? this.data.alerts : this.data.replies).find(row => String(row.id) === String(id))
      if (!item || !item.revision || !this._alive || !this._visible || this.data.allReading) return
      const token = getToken()
      const url = kind === 'GLUCOSE'
        ? `/pages/stats/stats?date=${encodeURIComponent(item.recordDate)}&nodeCode=${encodeURIComponent(item.nodeCode)}`
        : `/pages/glucose-reply/glucose-reply?id=${encodeURIComponent(item.id)}`
      wx.navigateTo({ url, success: () => {
        if (getToken() !== token) return
        this.closeNotice()
        // 具体回复页会在内容加载成功后标记；实测提醒已在当前弹窗完整展示。
        if (kind === 'GLUCOSE') this.consumeReminder(item, token)
      }, fail: () => {
        if (getToken() === token) wx.showToast({ title: '页面打开失败，请重试', icon: 'none' })
      } })
    },
    onReadReminder(e) {
      const { kind, id } = e.currentTarget.dataset
      const item = (kind === 'GLUCOSE' ? this.data.alerts : this.data.replies).find(row => String(row.id) === String(id))
      return this.consumeReminder(item, getToken())
    },
    async consumeReminder(item, token) {
      if (!item || !item.revision || !token || getToken() !== token || this.data.allReading) return
      const key = `${item.kind}:${item.id}:${item.revision}`
      this._readingKeys = this._readingKeys || new Set()
      const pending = this._readingKeys
      if (pending.has(key)) return
      pending.add(key)
      if (this._alive && this._visible) this.setData({ reading: key })
      try {
        await readUserReminder(item.kind, item.id, item.revision)
        if (getToken() !== token) return
        if (this._alive && this._visible) {
          const field = item.kind === 'GLUCOSE' ? 'alerts' : 'replies'
          const items = this.data[field].filter(row => !(String(row.id) === String(item.id) && row.revision === item.revision))
          const removed = this.data[field].length - items.length
          this.setData({ [field]: items, ...(field === 'replies' ? { replyTotal: Math.max(0, this.data.replyTotal - removed) } : {}) })
          // 作废标记前已发出的旧列表，避免迟到响应把刚读过的提醒放回来。
          this._replyVersion = (this._replyVersion || 0) + 1
          this._replyPending = false
          await this.refreshReplies()
          wx.showToast({ title: '已标为已读', icon: 'none' })
        }
      } catch (error) {
        if (getToken() === token && this._alive && this._visible) {
          wx.showToast({ title: error.message || '标记失败，请重试', icon: 'none' })
          if (error.statusCode === 409 || error.code === 40900) this.refreshReplies()
        }
      } finally {
        pending.delete(key)
        if (this._alive && this._visible && getToken() === token) this.setData({ reading: '' })
      }
    },
    async onReadInformation(e) {
      if (!this._alive || !this._visible || this.data.informationReading || this.data.allReading) return
      const key = e.currentTarget.dataset.key
      const kind = {messages:'MESSAGE',likes:'LIKE',collections:'COLLECT',comments:'COMMENT',follows:'FOLLOW',reports:'REPORT'}[key]
      const token = getToken()
      if (!kind || !token) return
      this.setData({ informationReading: key })
      try {
        await readInformationCategory(kind)
        if (getToken() === token) {
          await notifications.refresh(true)
          if (this._alive && this._visible) wx.showToast({ title: '已标为已读', icon: 'none' })
        }
      } catch (error) {
        if (getToken() === token && this._alive && this._visible) wx.showToast({ title: error.message || '标记失败，请重试', icon: 'none' })
      } finally {
        if (getToken() === token && this._alive && this._visible) this.setData({ informationReading: '' })
      }
    },
    refreshReplies() { return this.loadReplies(false) },
    loadMoreReplies() { if (this.data.hasMoreReplies) return this.loadReplies(true) },
    async loadReplies(append) {
      const token = getToken()
      if (!this._alive || !this._visible) return
      if (this._replyToken !== token) {
        // 首次加载不干扰用户主动打开；真正切换账号时关闭旧账号详情。
        if (this._replyToken !== undefined) this.closeNotice()
        this._replyVersion = (this._replyVersion || 0) + 1
        this._replyPending = false; this._replyPage = 0; this._replyToken = token; this._receiptLoaded = false
        this._readingKeys = new Set()
        this.setData({ alerts: [], replies: [], replyTotal: 0, hasMoreReplies: false, repliesLoading: false, repliesError: '', reading:'', informationReading:'', allReading:false })
      }
      if (!token || this._replyPending) return
      const version = (this._replyVersion || 0) + 1
      this._replyVersion = version; this._replyPending = true
      const pageNum = append ? (this._replyPage || 0) + 1 : 1
      this._replyAppend = append
      this.setData({ repliesLoading: true, repliesError: '' })
      const current = () => this._alive && this._visible && version === this._replyVersion && getToken() === token
      try {
        const result = await fetchUserReminders({ date: getTodayKey(), pageNum, pageSize: 3 })
        const page = result && result.replies
        if (!current()) return
        if (!page || !Array.isArray(page.records) || !Number.isFinite(Number(page.total))) throw new Error('回复读取失败，请重试')
        const fresh = page.records.filter((item) => item && typeof item.userReply === 'string' && item.userReply.trim())
          .map((item) => ({ kind: 'REPLY', id: item.id, revision: item.revision, nodeCode: item.nodeCode, recordId: item.recordId, recordDate: item.recordDate,
            nodeName: item.nodeName, glucoseValue: item.glucoseValue, recordedAtText: formatTime(item.recordedAt),
            userReply: item.userReply, repliedAtText: formatTime(item.repliedAt) }))
        const combined = append ? this.data.replies.concat(fresh) : fresh
        const replies = combined.filter((item, index) => combined.findIndex((other) => other.id === item.id) === index)
        this._replyPage = pageNum
        this._receiptLoaded = true
        const alerts = (result.alerts || []).map(item => ({ ...item, name: item.nodeName, value: String(item.glucoseValue), type: Number(item.glucoseValue) < 3.9 ? 'low' : 'high', label: Number(item.glucoseValue) < 3.9 ? '低值提醒' : '高值提醒' }))
        this.setData({ alerts, replies, replyTotal: Number(page.total), hasMoreReplies: pageNum * 3 < Number(page.total) })
      } catch (error) {
        if (current()) this.setData({ repliesError: error.message || '回复读取失败，请重试' })
      } finally {
        if (version === this._replyVersion) {
          this._replyPending = false
          if (this._alive && this._visible) {
            // token改变时立即移除旧账号回复，绝不等待下次返回页面。
            if (getToken() !== token) {
              this.closeNotice()
              this.setData({ alerts: [], replies: [], replyTotal: 0, hasMoreReplies: false })
            }
            this.setData({ repliesLoading: false })
          }
        }
      }
    },
    onRetryReplies() { return this.loadReplies(!!this._replyAppend) }
  }
})
