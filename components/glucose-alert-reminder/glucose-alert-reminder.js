const { buildGlucoseAlerts } = require('../../utils/glucose-alerts')
const { fetchGlucoseAlertReplies } = require('../../services/api')
const { getToken } = require('../../utils/request')

function formatTime(value) {
  return typeof value === 'string' ? value.replace('T', ' ').replace(/\.\d+$/, '') : ''
}

Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    nodes: { type: Array, value: [], observer(nodes) { this.setData({ alerts: buildGlucoseAlerts(nodes) }) } }
  },
  data: { alerts: [], replies: [], noticeVisible: false, replyTotal: 0, repliesLoading: false, repliesError: '', hasMoreReplies: false },
  lifetimes: {
    attached() { this._alive = true; this._visible = true; this.refreshReplies() },
    detached() { this._alive = false; this._replyVersion = (this._replyVersion || 0) + 1 }
  },
  pageLifetimes: {
    show() { this._visible = true; this.refreshReplies() },
    hide() {
      this._visible = false
      this.closeNotice()
      this._replyVersion = (this._replyVersion || 0) + 1
      this._replyPending = false
      this.setData({ replies: [], replyTotal: 0, repliesLoading: false, repliesError: '', hasMoreReplies: false })
    }
  },
  methods: {
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
    refreshReplies() { return this.loadReplies(false) },
    loadMoreReplies() { if (this.data.hasMoreReplies) return this.loadReplies(true) },
    async loadReplies(append) {
      const token = getToken()
      if (!this._alive || !this._visible) return
      if (this._replyToken !== token) {
        // 首次加载不干扰用户主动打开；真正切换账号时关闭旧账号详情。
        if (this._replyToken !== undefined) this.closeNotice()
        this._replyVersion = (this._replyVersion || 0) + 1
        this._replyPending = false; this._replyPage = 0; this._replyToken = token
        this.setData({ replies: [], replyTotal: 0, hasMoreReplies: false, repliesLoading: false, repliesError: '' })
      }
      if (!token || this._replyPending) return
      const version = (this._replyVersion || 0) + 1
      this._replyVersion = version; this._replyPending = true
      const pageNum = append ? (this._replyPage || 0) + 1 : 1
      this._replyAppend = append
      this.setData({ repliesLoading: true, repliesError: '' })
      const current = () => this._alive && this._visible && version === this._replyVersion && getToken() === token
      try {
        const page = await fetchGlucoseAlertReplies(pageNum, 3)
        if (!current()) return
        if (!page || !Array.isArray(page.records) || !Number.isFinite(Number(page.total))) throw new Error('回复读取失败，请重试')
        const fresh = page.records.filter((item) => item && typeof item.userReply === 'string' && item.userReply.trim())
          .map((item) => ({ id: item.id, recordId: item.recordId, recordDate: item.recordDate,
            nodeName: item.nodeName, glucoseValue: item.glucoseValue, recordedAtText: formatTime(item.recordedAt),
            userReply: item.userReply, repliedAtText: formatTime(item.repliedAt) }))
        const combined = append ? this.data.replies.concat(fresh) : fresh
        const replies = combined.filter((item, index) => combined.findIndex((other) => other.id === item.id) === index)
        this._replyPage = pageNum
        this.setData({ replies, replyTotal: Number(page.total), hasMoreReplies: pageNum * 3 < Number(page.total) })
      } catch (error) {
        if (current()) this.setData({ repliesError: error.message || '回复读取失败，请重试' })
      } finally {
        if (version === this._replyVersion) {
          this._replyPending = false
          if (this._alive && this._visible) {
            // token改变时立即移除旧账号回复，绝不等待下次返回页面。
            if (getToken() !== token) {
              this.closeNotice()
              this.setData({ replies: [], replyTotal: 0, hasMoreReplies: false })
            }
            this.setData({ repliesLoading: false })
          }
        }
      }
    },
    onRetryReplies() { return this.loadReplies(!!this._replyAppend) }
  }
})
