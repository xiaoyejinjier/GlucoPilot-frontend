const api = require('../../services/consultation')
const social = require('../../utils/community')
const { identifier } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', records: [], loading: false, error: '', hasMore: false },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this); applyDisplayToCurrentPage()
    if (previous && previous !== this._communityToken) this.setData({ records: [] })
    this.load(false)
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1; this._busy = false },
  onUnload() { this.onHide() },
  onPullDownRefresh() { return this.load(false).finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() { if (this.data.hasMore && !this._busy) return this.load(true) },
  onRetry() { return this.load(false) },
  async load(append) {
    if (!social.active(this) || (append && this._busy)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this._busy = true
    const pageNum = append ? this._page + 1 : 1
    this.setData({ loading: true, error: '' })
    try {
      const page = await api.conversations({ pageNum, pageSize: 20 })
      if (!social.active(this, version) || run !== this._run) return
      const fresh = (page.records || []).map(row => ({ ...row, timeLabel: social.timeLabel(row.lastMessageAt) }))
      const records = append ? this.data.records.concat(fresh) : fresh
      this._page = pageNum
      this.setData({ records: records.filter((row, index) => records.findIndex(other => String(other.consultationId) === String(row.consultationId)) === index), hasMore: pageNum < Number(page.pages) })
    } catch (error) {
      if (social.active(this, version) && run === this._run) { this.setData({ error: error.message || '交流记录加载失败，请重试' }); social.failure(this, error, version) }
    } finally {
      if (social.active(this, version) && run === this._run) { this._busy = false; this.setData({ loading: false }) }
    }
  },
  onOpen(event) {
    const id = identifier(event.currentTarget.dataset.id)
    if (id && social.active(this)) wx.navigateTo({ url: `/pages/consultation-chat/consultation-chat?id=${id}` })
  }
})
