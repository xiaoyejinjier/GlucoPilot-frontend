const vault = require('../../utils/account-vault')
const accounts = require('../../services/accounts')
const { getToken, setToken } = require('../../utils/request')
const { getUserInfo, clearAccountCache, login } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '', accounts: [], loading: false, switching: false, switchingId: '', error: '' },
  onShow() {
    this._visible = true
    this._epoch = (this._epoch || 0) + 1
    this._token = getToken()
    this._scope = vault.scope()
    this._busy = false
    applyDisplayToCurrentPage()
    this.setData({ switching: false, switchingId: '' })
    vault.remember(getUserInfo(), this._token)
    this.renderAccounts()
    return this.load()
  },
  onHide() { this._visible = false; this._epoch = (this._epoch || 0) + 1 },
  onUnload() { this.onHide() },
  active(epoch) { return this._visible && epoch === this._epoch && this._token === getToken() && this._scope === vault.scope() },
  renderAccounts() { this.setData({ accounts: vault.list(getToken()) }) },
  async load() {
    if (this._busy || !this.active(this._epoch)) return
    const epoch = this._epoch
    this.setData({ loading: true, error: '' })
    const sessions = vault.list().map(row => vault.session(row.id)).filter(row => row && row.token)
    if (this._token && !sessions.some(row => row.token === this._token)) sessions.push({ token: this._token })
    let failed = false
    await Promise.all(sessions.map(async session => {
      try {
        const result = await accounts.inspect(session.token, session.id)
        if (!this.active(epoch)) return
        if (session.id && (!vault.session(session.id) || vault.session(session.id).token !== session.token)) return
        vault.remember(result.profile, session.token, result.doctorStatus)
      } catch (error) {
        if (!this.active(epoch)) return
        if (error.code === 40100 || error.code === 40101 || error.code === 40300) vault.invalidateToken(session.token)
        else failed = true
      }
    }))
    if (!this.active(epoch)) return
    this.renderAccounts()
    this.setData({ loading: false, error: failed ? '部分账号状态暂时无法更新，点击重试' : '' })
  },
  onRefresh() { return this.load() },
  async onSelect(event) {
    if (this._busy || !this.active(this._epoch)) return
    const id = String(event.currentTarget.dataset.id || '')
    const session = vault.session(id)
    if (!session) return
    if (session.token && session.token === getToken()) return
    if (!session.token) return this.startLogin(session.phone)
    const epoch = this._epoch
    this._busy = true
    this.setData({ switching: true, switchingId: id, error: '' })
    try {
      const result = await accounts.inspect(session.token, id)
      if (!this.active(epoch) || !vault.session(id) || vault.session(id).token !== session.token) return
      vault.remember(result.profile, result.token, result.doctorStatus)
      vault.touch(id)
      const app = getApp()
      app.resetLoginState({ preserveSavedAccount: true })
      clearAccountCache()
      // 云同步节流属于旧账号，切换后应允许新账号正常同步。
      wx.removeStorageSync('lastCloudPullAt')
      setToken(result.token)
      login(result.profile)
      app.globalData.isLoggedIn = true
      app.globalData.userInfo = result.profile
      this._token = result.token
      this._epoch++
      this.renderAccounts()
      await app.goAfterLogin()
    } catch (error) {
      if (!this.active(epoch)) return
      if (error.code === 40100 || error.code === 40101 || error.code === 40300) {
        vault.invalidateToken(session.token)
        this.renderAccounts()
        wx.showToast({ title: '该账号需要重新验证登录', icon: 'none' })
        this.startLogin(session.phone, true)
      } else {
        this.setData({ error: error.message || '切换失败，请重试' })
      }
    } finally {
      this._busy = false
      if (this._visible) this.setData({ switching: false, switchingId: '' })
    }
  },
  onAddAccount() { if (!this._busy) this.startLogin('') },
  startLogin(phone, fromSwitch = false) {
    if (!this.active(this._epoch) || (!fromSwitch && this._busy)) return
    const app = getApp()
    app.resetLoginState({ preserveSavedAccount: true })
    clearAccountCache()
    wx.removeStorageSync('lastCloudPullAt')
    app.globalData.pendingLoginPhone = /^1\d{10}$/.test(String(phone || '')) ? String(phone) : ''
    app.globalData.accountSwitchFlow = true
    this._epoch++
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
