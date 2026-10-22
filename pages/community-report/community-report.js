const api = require('../../services/api')
const social = require('../../utils/community')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { reportUrl } = require('../../utils/publication')
Page({
  data:{ displayStyle:'', targetLabel:'', reason:'', details:'', sending:false, success:false, valid:false,
    reasons:[{ code:'MISINFORMATION', title:'健康信息不实', description:'夸大疗效、误导用药或传播未经核实的信息' },{ code:'SPAM', title:'广告或垃圾信息', description:'营销引流、重复刷屏等' },{ code:'ABUSE', title:'攻击辱骂', description:'侮辱、人身攻击或不友善的表达' },{ code:'PRIVACY', title:'泄露隐私', description:'未经允许公开个人信息' },{ code:'OTHER', title:'其他问题', description:'请在下方补充具体情况' }] },
  onLoad(options) { this._type = options.type; this._id = String(options.id || ''); this.setData({ valid:!!reportUrl(this._type,this._id), targetLabel:({ ARTICLE:'文章', COMMENT:'评论', USER:'用户', MESSAGE:'私信' })[this._type] || '内容' }) },
  onShow() { if (!getApp().checkLogin()) return
    if (this._communityToken && this._communityToken !== require('../../utils/request').getToken()) { this._attempt = null; this.setData({ reason:'', details:'', success:false }) }
    social.begin(this); applyDisplayToCurrentPage(); this.setData({ sending:false }) },
  onHide() { social.end(this) }, onUnload() { social.end(this) },
  onReason(e) { if (!this.data.sending && this.data.reasons.some(reason => reason.code === e.currentTarget.dataset.code)) this.setData({ reason:e.currentTarget.dataset.code }) },
  onDetails(e) { this.setData({ details:e.detail.value }) },
  async onSubmit() {
    if (!social.active(this) || this.data.sending || this.data.success || !this.data.valid) return
    if (!this.data.reason) return wx.showToast({ title:'请选择举报原因', icon:'none' })
    if (this.data.reason === 'OTHER' && !this.data.details.trim()) return wx.showToast({ title:'请补充具体问题', icon:'none' })
    const values = { targetType:this._type, targetId:this._id, reason:this.data.reason, details:this.data.details.trim() }, fingerprint = JSON.stringify(values)
    if (!this._attempt || this._attempt.fingerprint !== fingerprint) this._attempt = { fingerprint, payload:{ ...values, clientRequestId:social.requestId() } }
    const version = this._communityVersion; this.setData({ sending:true })
    try { await api.reportCommunityContent(this._attempt.payload); if (social.active(this,version)) { this._attempt = null; this.setData({ success:true }) } }
    catch (error) { social.failure(this,error,version) }
    finally { if (social.active(this,version)) this.setData({ sending:false }) }
  },
  onMyReports(){if(social.active(this))wx.navigateTo({url:'/pages/community-reports/community-reports'})},
  onBack() { wx.navigateBack({ delta:1 }) }
})
