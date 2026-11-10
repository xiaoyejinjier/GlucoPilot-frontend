const api = require('../../services/api')
const social = require('../../utils/community')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle:'', item:null, loading:false, error:'', readError:'', reading:false },
  onLoad(options) { this._id = /^[1-9]\d{0,18}$/.test(String(options.id || '')) ? String(options.id) : '' },
  onShow() { if (!getApp().checkLogin()) return; social.begin(this); applyDisplayToCurrentPage(); this.load() },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load() {
    const run = this._run = (this._run || 0) + 1
    if (!social.active(this)) return
    if (!this._id) { this.setData({error:'提醒不存在或已更新'}); return }
    this.setData({loading:true,error:'',readError:'',item:null,reading:false})
    try {
      const item = await api.fetchUserReminder('REPLY', this._id)
      if (!social.active(this) || run !== this._run) return
      this.setData({item:{...item,timeText:social.timeLabel(item.repliedAt)},loading:false}, () => {
        if (social.active(this) && run === this._run) this.markRead()
      })
    } catch (error) {
      if (social.active(this) && run === this._run) { this.setData({loading:false,error:error.message || '回复读取失败，请重试'}); social.failure(this,error) }
    }
  },
  async markRead() {
    const item = this.data.item
    if (!social.active(this) || !item || item.read || this.data.reading) return
    const token = getToken(), run = this._run
    this.setData({reading:true,readError:''})
    try {
      await api.readUserReminder('REPLY',item.id,item.revision)
      if (social.active(this) && run === this._run && getToken() === token) this.setData({item:{...item,read:true}})
    } catch (error) {
      if (social.active(this) && run === this._run) this.setData({readError:error.message || '标记失败，请重试'})
    } finally {
      if (social.active(this) && run === this._run) this.setData({reading:false})
    }
  },
  onRecord() {
    const item = this.data.item
    if (item && social.active(this)) wx.navigateTo({url:`/pages/stats/stats?date=${encodeURIComponent(item.recordDate)}&nodeCode=${encodeURIComponent(item.nodeCode)}`})
  },
  onRetry() { return this.load() },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } }
})
