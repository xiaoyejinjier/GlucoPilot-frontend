const api = require('../../services/consultation')
const wallet = require('../../services/wallet')
const social = require('../../utils/community')
const { identifier, preview, decorate, money } = require('../../utils/consultation')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { loadPhoto } = require('../../utils/consultation-media')

Page({
  data: { displayStyle: '', previewMode: false, item: null, report: null, unlocked: false,
    doctorView: false, showPaymentFooter: false,
    price: '1.00', loading: false, error: '', saving: false,
    walletReady: false, walletLoading: false, walletActivated: false, walletError: '',
    photos:[],photosError:'',chatEnabled:false,
    form: { assessment: '', medicationAdvice: '', followUpAdvice: '' } },
  onLoad(options) {
    this._id = identifier(options.id); this._preview = options.preview === '1'; this._token = getToken()
    if (this._preview) {
      this.showItem(preview())
      const channel = typeof this.getOpenerEventChannel === 'function' && this.getOpenerEventChannel()
      if (channel && channel.on) channel.on('consultationPreview', item => {
        if (this._token === getToken()) this.showItem(preview(item))
      })
    }
  },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage()
    this.setData({ saving: false })
    if (this._token !== getToken()) { this._reportAttempt = null; this.setData({ item: null, report: null, unlocked: false, doctorView: false, showPaymentFooter: false, walletReady: false, walletLoading: false, walletActivated: false, walletError: '',photos:[],chatEnabled:false, form: { assessment: '', medicationAdvice: '', followUpAdvice: '' }, error: '请重新打开问诊记录' }); return }
    if (!this._preview) this.load()
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  showItem(item) {
    const report = item.report || { access: 'LOCKED', feeCents: 100 }
    // 仅服务端明确返回已解锁内容时展示；支付页及客户端状态不能授予阅读权限。
    const unlocked = !this._preview && report.access === 'UNLOCKED'
    const doctorView = !this._preview && (item.canReply === true || (item.mine === false && unlocked))
    const showPaymentFooter = !unlocked && !doctorView && (this._preview || (item.mine === true && report.ready === true))
    const chatEnabled=!this._preview&&item.detailsVisible===true&&['IN_PROGRESS','REPORT_READY','CLOSED'].includes(item.status)
    const safeReport = unlocked ? report : {
      id: report.id, ready: !!report.ready, access: 'LOCKED', feeCents: report.feeCents,
      doctorName: report.doctorName, specialty: report.specialty
    }
    this.setData({ item: decorate({ ...item, report: item.report ? safeReport : null }), report: safeReport,
      unlocked, doctorView, showPaymentFooter,chatEnabled,
      price: money(report.feeCents == null ? 100 : report.feeCents), previewMode: this._preview })
    if(this._preview)this.setData({photos:item.imagePreviews||[]})
  },
  async load() {
    if (!social.active(this)) return
    if (!this._id) { this.setData({ error: '问诊记录不存在或尚未发布' }); return }
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({ loading: true, error: '', walletReady: false, walletLoading: false, walletActivated: false, walletError: '', photos:[],photosError:'' })
    try {
      const item = await api.detail(this._id)
      if (social.active(this, version) && run === this._run) {
        this.showItem(item); this.setData({ loading: false })
        await Promise.all([item.canClaim?this.loadWallet():Promise.resolve(),this.loadExtras()])
      }
    } catch (error) {
      if (social.active(this, version) && run === this._run) {
        this.setData({ loading: false, error: error.message || '问诊记录加载失败' }); social.failure(this, error, version)
      }
    }
  },
  async loadExtras() {
    if(!social.active(this)||!this.data.item||!this.data.item.detailsVisible)return
    await this.loadPhotos()
  },
  async loadPhotos() {
    const version=this._communityVersion,run=this._run
    try {
      const rows=await api.images(this._id)
      const photos=await Promise.all(rows.map(async row=>({...row,url:await loadPhoto(row.url)})))
      if(social.active(this,version)&&run===this._run)this.setData({photos,photosError:''})
    } catch(error){if(social.active(this,version)&&run===this._run)this.setData({photosError:error.message||'问诊图片加载失败'})}
  },
  onPreviewPhoto(event){const urls=this.data.photos.map(row=>row.url);if(urls.length)wx.previewImage({urls,current:event.currentTarget.dataset.url})},
  onChat() {
    if (social.active(this) && this.data.chatEnabled)
      wx.navigateTo({ url: `/pages/consultation-chat/consultation-chat?id=${this._id}` })
  },
  async loadWallet() {
    if (!social.active(this) || this.data.walletLoading) return
    const version = this._communityVersion, run = this._run
    this.setData({ walletLoading: true, walletReady: false, walletError: '' })
    try {
      const summary = await wallet.summary()
      if (social.active(this, version) && run === this._run)
        this.setData({ walletReady: true, walletActivated: summary.activated === true })
    } catch (error) {
      if (social.active(this, version, error) && run === this._run) {
        this.setData({ walletError: error.message || '钱包状态加载失败，请重试' })
        if (error.code === 40100) social.failure(this, error, version)
      }
    } finally { if (social.active(this, version) && run === this._run) this.setData({ walletLoading: false }) }
  },
  onWallet() { if (social.active(this) && !this.data.saving) wx.navigateTo({ url: '/pages/wallet/wallet' }) },
  onWalletRetry() { return this.loadWallet() },
  onCheckout() {
    if (!social.active(this) || this.data.unlocked || !this.data.showPaymentFooter) return
    const reportId = identifier(this.data.report && this.data.report.id)
    const query = !this._preview && reportId ? `reportId=${reportId}` : 'preview=1'
    wx.navigateTo({ url: `/pages/consultation-checkout/consultation-checkout?${query}` })
  },
  onField(event) {
    const field = event.currentTarget.dataset.field
    if (!this.data.saving && this.data.item && this.data.item.canReply && Object.prototype.hasOwnProperty.call(this.data.form, field)) {
      this._reportAttempt = null
      this.setData({ [`form.${field}`]: event.detail.value })
    }
  },
  onWriteReport() {
    if (!social.active(this) || !this.data.item || !this.data.item.canReply) return
    wx.pageScrollTo({ selector: '#consultation-report-editor', duration: 220 })
  },
  onClaim() {
    if (!social.active(this) || this.data.saving || !this.data.item || !this.data.item.canClaim || !this.data.walletReady) return
    if (!this.data.walletActivated) { this.onWallet(); return }
    const version = this._communityVersion
    wx.showModal({ title: '确认接诊', content: '接诊后可查看健康详情并出具问诊单。',
      success: result => { if (result.confirm && social.active(this, version)) this.claim() } })
  },
  async claim() {
    if (!social.active(this) || this.data.saving || !this.data.item || !this.data.item.canClaim || !this.data.walletReady || !this.data.walletActivated) return
    const version = this._communityVersion
    this.setData({ saving: true })
    try {
      const item = await api.claim(this._id)
      if (social.active(this, version)) {
        this.showItem(item)
        wx.showToast({ title: '接诊成功，请填写问诊单', icon: 'none' })
        await this.loadExtras()
      }
    } catch (error) { if (social.active(this, version)) social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ saving: false }) }
  },
  onSubmitReport() {
    if (!social.active(this) || this.data.saving || !this.data.item || !this.data.item.canReply) return
    if (Object.values(this.data.form).some(value => !value.trim())) {
      wx.showToast({ title: '请填写完整问诊单', icon: 'none' }); return
    }
    const version = this._communityVersion
    wx.showModal({ title: '确认出具问诊单', content: '提交后不能修改，请核对评估与建议。',
      success: result => { if (result.confirm && social.active(this, version)) this.submitReport() } })
  },
  async submitReport() {
    if (!social.active(this) || this.data.saving || !this.data.item || !this.data.item.canReply) return
    const version = this._communityVersion
    if (!this._reportAttempt) this._reportAttempt = { ...this.data.form, clientRequestId: social.requestId() }
    this.setData({ saving: true })
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    try {
      const item = await api.issueReport(this._id, this._reportAttempt)
      if (!social.active(this, version)) return
      this.showItem(item)
      this._reportAttempt = null
      this.setData({ form: { assessment: '', medicationAdvice: '', followUpAdvice: '' } })
      wx.showToast({ title: '问诊单已出具', icon: 'success' })
    } catch (error) { if (social.active(this, version)) social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ saving: false }) }
  },
  onRetry() { return this.load() }
})
