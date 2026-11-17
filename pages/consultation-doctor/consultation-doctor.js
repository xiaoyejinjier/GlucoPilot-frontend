const api = require('../../services/consultation')
const wallet = require('../../services/wallet')
const social = require('../../utils/community')
const { decorate } = require('../../utils/consultation')
const { applyDisplayToCurrentPage } = require('../../utils/display')

const labels = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过', DISABLED: '已停用' }
const emptyForm = () => ({ realName: '', hospital: '', specialty: '', licenseNumber: '', qualificationNote: '' })
Page({
  data: { displayStyle: '', loading: false, saving: false, error: '', profile: null,
    statusLabel: '', records: [], form: emptyForm(), canEdit: false, pageNum: 0, hasMore: false,
    walletReady: false, walletLoading: false, walletActivated: false, walletError: '' },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); this._paging = false; applyDisplayToCurrentPage(); this.load()
  },
  onHide() { social.end(this); this._run = (this._run || 0) + 1 },
  onUnload() { this.onHide() },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({ loading: true, saving: false, error: '', profile: null,
      form: emptyForm(), records: [], canEdit: false, hasMore: false, pageNum: 0,
      walletReady: false, walletLoading: false, walletActivated: false, walletError: '' })
    try {
      const profile = await api.doctor()
      if (!social.active(this, version) || run !== this._run) return
      this.showProfile(profile)
      if (profile && profile.status === 'APPROVED') await Promise.all([this.loadCases(true), this.loadWallet()])
    } catch (error) {
      if (!social.active(this, version) || run !== this._run) return
      this.setData({ error: error.message || '医生资料加载失败，请重试' }); social.failure(this, error, version)
    } finally { if (social.active(this, version) && run === this._run) this.setData({ loading: false }) }
  },
  showProfile(profile, preserveForm = false) {
    const form = emptyForm()
    if (profile) Object.keys(form).forEach(key => { form[key] = profile[key] || '' })
    this.setData({ profile, ...(preserveForm ? {} : { form }), statusLabel: profile ? labels[profile.status] || profile.status : '未提交',
      canEdit: !profile || ['PENDING', 'REJECTED'].includes(profile.status) })
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
  async loadCases(reset = false) {
    if (!social.active(this) || this._paging || (!reset && !this.data.hasMore)) return
    const version = this._communityVersion, pageNum = reset ? 1 : this.data.pageNum + 1
    this._paging = true
    try {
      const page = await api.list({ assigned: true, pageNum, pageSize: 10 })
      if (!social.active(this, version)) return
      const rows = (page.records || []).map(decorate)
      this.setData({ records: reset ? rows : this.data.records.concat(rows), pageNum, hasMore: pageNum < Number(page.pages) })
    } catch (error) { if (social.active(this, version)) social.failure(this, error, version) }
    finally { if (social.active(this, version)) this._paging = false }
  },
  onField(event) {
    const key = event.currentTarget.dataset.field
    if (this.data.canEdit && !this.data.saving && Object.prototype.hasOwnProperty.call(this.data.form, key))
      this.setData({ [`form.${key}`]: event.detail.value })
  },
  async onApply() {
    if (!social.active(this) || this.data.saving || !this.data.canEdit) return
    if (Object.values(this.data.form).some(value => !value.trim())) {
      wx.showToast({ title: '请填写完整医生资料', icon: 'none' }); return
    }
    const version = this._communityVersion
    // 收起键盘后仅更新状态，避免移除/重建表单引起页面回弹。
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard()
    this.setData({ saving: true })
    try {
      const profile = await api.applyDoctor({ ...this.data.form })
      if (!social.active(this, version)) return
      this.showProfile(profile, true)
      wx.showToast({ title: '已提交审核', icon: 'success' })
    } catch (error) { if (social.active(this, version)) social.failure(this, error, version) }
    finally { if (social.active(this, version)) this.setData({ saving: false }) }
  },
  onOpen(event) {
    const row = this.data.records.find(item => item.id === String(event.currentTarget.dataset.id))
    if (row) wx.navigateTo({ url: `/pages/consultation-detail/consultation-detail?id=${row.id}` })
  },
  onWallet() { if (social.active(this)) wx.navigateTo({ url: '/pages/wallet/wallet' }) },
  onWalletRetry() { return this.loadWallet() },
  onWithdrawals(){if(social.active(this)&&this.data.profile&&this.data.profile.status==='APPROVED')wx.navigateTo({url:'/pages/doctor-withdrawals/doctor-withdrawals'})},
  onFind() { wx.switchTab({ url: '/pages/consultation/consultation' }) },
  onRetry() { return this.load() },
  onReachBottom() { return this.loadCases() },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } }
})
