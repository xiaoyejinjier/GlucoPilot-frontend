const {
  fetchCancellationStatus, fetchCancellationCaptcha, sendCancellationCode,
  submitCancellation, recoverCancellation, logoutRemote
} = require('../../services/api')
const { clearAccountCache } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const i18n = require('../../utils/i18n')

/** 注销原因与 user_account_cancellation.reason_code 对齐（1..4）。 */
const CANCEL_REASONS = [
  { code: 1, label: '不再使用' },
  { code: 2, label: '隐私顾虑' },
  { code: 3, label: '功能不满意' },
  { code: 4, label: '其他' }
]

const DEFAULT_COOLDOWN = 60

/** 服务端时间戳为 epoch 毫秒（Long 序列化成字符串）。 */
function formatDeadline(value) {
  const ms = Number(value)
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    displayStyle: '',
    locale: i18n.getLocale(),
    // applying=正常申请流；pending=注销处理中（7 天可恢复窗口）；gone=已注销/执行中兜底；loading/error
    page: 'loading',
    errorText: '注销状态加载失败，请返回重试。',
    deadline: '',
    reasons: CANCEL_REASONS,
    mode: 1,
    reasonCode: 0,
    agreed: false,
    // 验证方式：1=手机/邮箱验证 3=微信身份验证；0=两者都不可用（异常态）
    verifyMode: 0,
    canUseCode: false,
    canUseWechat: false,
    hasPhone: false,
    hasEmail: false,
    hasWechat: false,
    // 脱敏后的发送目标，用于“验证码将发送至 …”提示
    phoneTarget: '',
    emailTarget: '',
    // 手机/邮箱验证下的具体通道：1=短信 2=邮箱
    codeChannel: 1,
    verifyCode: '',
    // 倒计时按通道独立维护，切换验证方式不会串扰
    smsCooldown: 0,
    emailCooldown: 0,
    // 当前通道的倒计时与发送目标提示，由 refreshHint 预计算，避免 WXML 嵌套三元
    cooldownLeft: 0,
    targetHint: '验证码将发送至已绑定手机号',
    wechatVerified: false,
    sliderVisible: false,
    sliderHint: '按住滑块，拖动到最右侧',
    submitting: false,
    recovering: false
  },

  onLoad() {
    // wx.login code 一次性有效：仅在“微信身份验证”成功后短暂持有，提交时随请求消费。
    this._wechatCode = ''
    this._timers = {}
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.setData({ locale: i18n.getLocale() })
    this.refresh()
  },

  onUnload() {
    Object.keys(this._timers || {}).forEach((key) => clearInterval(this._timers[key]))
  },

  refresh() {
    fetchCancellationStatus()
      .then((data) => {
        const info = data || {}
        const record = info.cancellation || null
        const recordActive = !!(record && (record.status === 0 || record.status === 1))
        if (info.accountStatus === 4 || recordActive) {
          this.setData({
            page: 'pending',
            deadline: formatDeadline(record && record.isolateUntil)
          })
          return
        }
        if (info.accountStatus === 2 || info.accountStatus === 3) {
          this.setData({ page: 'gone' })
          return
        }
        // 契约兜底：三个绑定标志缺失说明前后端版本不一致，不能当成“未绑定”渲染。
        if (typeof info.hasPhone !== 'boolean'
          || typeof info.hasEmail !== 'boolean'
          || typeof info.hasWechat !== 'boolean') {
          wx.showToast({ title: '服务版本不兼容，请稍后重试', icon: 'none' })
          this.setData({
            page: 'error',
            errorText: '服务版本不兼容，请更新小程序或稍后重试。'
          })
          return
        }
        // 正常/禁用账号（DISABLED 可自助注销）：完整申请流
        const hasPhone = !!info.hasPhone
        const hasEmail = !!info.hasEmail
        const hasWechat = !!info.hasWechat
        const canUseCode = hasPhone || hasEmail
        const canUseWechat = hasWechat
        const patch = {
          page: 'applying',
          hasPhone,
          hasEmail,
          hasWechat,
          canUseCode,
          canUseWechat,
          phoneTarget: info.phoneMasked || '',
          emailTarget: info.emailMasked || ''
        }
        // 首次进入才重置验证方式；已有选择保持不变，避免刷新打断用户操作。
        if (this.data.page !== 'applying') {
          // 纯微信账号锁定微信验证；有手机/邮箱时默认手机/邮箱；两者都无则提示异常。
          patch.verifyMode = canUseCode ? 1 : (canUseWechat ? 3 : 0)
          patch.codeChannel = hasPhone ? 1 : 2
        }
        this.setData(patch)
        this.refreshHint()
      })
      .catch((err) => {
        // 拿不到状态时不展示注销按钮，避免误导提交。
        wx.showToast({ title: (err && err.message) || '注销状态加载失败', icon: 'none' })
        this.setData({ page: 'error' })
      })
  },

  /** ---------- 状态 A：申请流 ---------- */

  onSelectMode(e) {
    const mode = Number(e.currentTarget.dataset.mode)
    if (mode !== 1 && mode !== 2) return
    this.setData({ mode })
  },

  onSelectReason(e) {
    const code = Number(e.currentTarget.dataset.code)
    this.setData({ reasonCode: this.data.reasonCode === code ? 0 : code })
  },

  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  onCodeInput(e) {
    this.setData({ verifyCode: e.detail.value.trim() })
  },

  /** 切换验证方式：清空另一模式的输入与凭证，防止表单串扰。 */
  onSwitchVerifyMode(e) {
    const mode = Number(e.currentTarget.dataset.mode)
    if (mode === this.data.verifyMode) return
    if (mode === 1 && !this.data.canUseCode) return
    if (mode === 3 && !this.data.canUseWechat) {
      wx.showToast({ title: '当前账号未绑定微信', icon: 'none' })
      return
    }
    this._wechatCode = ''
    this.setData({
      verifyMode: mode,
      verifyCode: '',
      wechatVerified: false,
      sliderVisible: false
    })
  },

  /** 同时绑定手机与邮箱时的轻量切换。 */
  onSwitchCodeChannel(e) {
    const channel = Number(e.currentTarget.dataset.channel)
    if (channel === this.data.codeChannel) return
    if (channel === 1 && !this.data.hasPhone) return
    if (channel === 2 && !this.data.hasEmail) return
    this.setData({ codeChannel: channel, verifyCode: '' })
    this.refreshHint()
  },

  /** 预计算当前通道的倒计时与发送目标，WXML 只做简单三元。 */
  refreshHint() {
    const { codeChannel, phoneTarget, emailTarget, smsCooldown, emailCooldown } = this.data
    const sms = codeChannel === 1
    const target = sms ? phoneTarget : emailTarget
    this.setData({
      cooldownLeft: sms ? smsCooldown : emailCooldown,
      targetHint: target
        ? `验证码将发送至${sms ? '手机' : '邮箱'} ${target}`
        : `验证码将发送至已绑定${sms ? '手机号' : '邮箱'}`
    })
  },

  /** 点击“获取验证码”：先出滑块，滑动完成前不取票、不发码。 */
  onSendCode() {
    if (this.data.verifyMode !== 1) return
    const left = this.data.codeChannel === 1 ? this.data.smsCooldown : this.data.emailCooldown
    if (left > 0) return
    if (this.data.codeChannel === 1 && !this.data.hasPhone) return
    if (this.data.codeChannel === 2 && !this.data.hasEmail) return
    this.setData({ sliderVisible: true })
  },

  onSliderCancel() {
    this.setData({ sliderVisible: false })
  },

  /** 滑块到最右：取一次性票据 → 带票据发码，两步都在滑动成功之后。 */
  onSliderUnlock() {
    const channel = this.data.codeChannel
    this.setData({ sliderVisible: false })
    wx.showLoading({ title: '验证中...', mask: true })
    fetchCancellationCaptcha()
      .then((res) => {
        const ticket = res && res.ticket
        if (!ticket) throw new Error('滑动验证失败，请重试')
        return sendCancellationCode(channel, ticket)
      })
      .then((res) => {
        wx.hideLoading()
        const target = (res && res.maskedTarget) || ''
        const cooldown = Number(res && res.cooldownSeconds) > 0
          ? Number(res.cooldownSeconds)
          : DEFAULT_COOLDOWN
        const patch = { verifyCode: '' }
        if (channel === 1) {
          patch.smsCooldown = cooldown
          if (target) patch.phoneTarget = target
        } else {
          patch.emailCooldown = cooldown
          if (target) patch.emailTarget = target
        }
        this.setData(patch)
        this.refreshHint()
        wx.showToast({ title: target ? `验证码已发送至 ${target}` : '验证码已发送', icon: 'none' })
        this.startCooldown(channel, cooldown)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' })
      })
  },

  startCooldown(channel, seconds) {
    if (this._timers[channel]) clearInterval(this._timers[channel])
    let left = seconds
    this._timers[channel] = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(this._timers[channel])
        delete this._timers[channel]
        this.setData(channel === 1 ? { smsCooldown: 0 } : { emailCooldown: 0 })
      } else {
        this.setData(channel === 1 ? { smsCooldown: left } : { emailCooldown: left })
      }
      if (this.data.codeChannel === channel) this.refreshHint()
    }, 1000)
  },

  /** 微信一键验证：wx.login code 一次性有效，暂存待提交时消费。 */
  onWechatVerify() {
    if (this.data.submitting || this.data.wechatVerified) return
    wx.showLoading({ title: '微信验证中...', mask: true })
    wx.login({
      timeout: 10000,
      success: (res) => {
        wx.hideLoading()
        if (!res.code) {
          wx.showToast({ title: '微信身份验证失败，请重试', icon: 'none' })
          return
        }
        this._wechatCode = res.code
        this.setData({ wechatVerified: true })
        wx.showToast({ title: '微信身份验证完成', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '微信身份验证失败，请重试', icon: 'none' })
      }
    })
  },

  onSubmit() {
    const {
      mode, reasonCode, agreed, verifyMode, codeChannel, verifyCode,
      wechatVerified, submitting, canUseCode, canUseWechat
    } = this.data
    if (submitting) return
    if (!agreed) {
      wx.showToast({ title: '请先勾选注销须知', icon: 'none' })
      return
    }

    let verifyType = 0
    if (verifyMode === 3 && canUseWechat) {
      if (!wechatVerified) {
        wx.showToast({ title: '请先完成微信身份验证', icon: 'none' })
        return
      }
      verifyType = 3
    } else if (verifyMode === 1 && canUseCode) {
      if (!/^\d{6}$/.test(verifyCode)) {
        wx.showToast({ title: '请输入 6 位验证码', icon: 'none' })
        return
      }
      verifyType = codeChannel
    } else {
      wx.showToast({ title: '当前账号无法完成身份验证，请联系客服', icon: 'none' })
      return
    }

    const recoverable = mode === 2
    wx.showModal({
      title: '确认注销账号',
      content: recoverable
        ? '提交后 7 天内可再次登录取消注销，期满后数据将被永久删除。'
        : '提交后账号立即注销，数据将被永久删除，无法恢复。',
      confirmText: '确认注销',
      confirmColor: '#fa5151',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ submitting: true })
        submitCancellation(
          mode,
          reasonCode || undefined,
          verifyType,
          verifyType === 3 ? undefined : verifyCode,
          verifyType === 3 ? this._wechatCode : undefined
        )
          .then(() => {
            // 提交成功即服务端撤销全部会话：同步清本地登录态与账号级缓存回登录页。
            const app = getApp()
            if (app && typeof app.resetLoginState === 'function') app.resetLoginState()
            clearAccountCache()
            wx.showToast({ title: recoverable ? '已提交注销申请' : '账号已注销', icon: 'none' })
            wx.reLaunch({ url: '/pages/login/login' })
          })
          .catch((err) => {
            // wx.login code 换取即消费：微信通道失败后必须重新验证。
            const patch = { submitting: false }
            if (verifyType === 3) {
              this._wechatCode = ''
              patch.wechatVerified = false
            }
            this.setData(patch)
            wx.showToast({ title: (err && err.message) || '注销失败', icon: 'none' })
          })
      }
    })
  },

  /** ---------- 状态 B：注销处理中 ---------- */

  /** 取消注销：登录会话即身份核验，无需验证码；恢复后按申请前状态还原。 */
  onRecover() {
    if (this.data.recovering) return
    wx.showModal({
      title: '取消注销',
      content: '取消后将继续使用本账号；7 天期满后数据将被删除且无法恢复。确认取消注销吗？',
      confirmText: '取消注销',
      cancelText: '暂不取消',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ recovering: true })
        wx.showLoading({ title: '正在取消注销...', mask: true })
        recoverCancellation()
          .then((res) => {
            wx.hideLoading()
            const status = res && res.accountStatus
            if (status === 0) {
              // 申请前即为禁用账号：还原后仍禁用，仅可办理注销或退出。
              wx.showModal({
                title: '注销已取消',
                content: '账号已恢复，但仍处于禁用状态，仅可办理注销或退出登录。',
                confirmText: '继续注销',
                cancelText: '退出登录',
                success: (r) => {
                  if (r.confirm) {
                    this.setData({ recovering: false, agreed: false })
                    this.refresh()
                  } else {
                    this.onExit()
                  }
                }
              })
              return
            }
            wx.showToast({ title: '注销已取消，欢迎回来', icon: 'success' })
            wx.switchTab({ url: '/pages/ai/ai' })
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ recovering: false })
            wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' })
          })
      }
    })
  },

  /** 退出登录：撤销远程会话、清账号级缓存并回登录页（契约注销章节缓存清单）。 */
  onExit() {
    Promise.resolve()
      .then(() => logoutRemote())
      .catch(() => null)
      .then(() => {
        const app = getApp()
        if (app && typeof app.resetLoginState === 'function') app.resetLoginState()
        clearAccountCache()
        wx.reLaunch({ url: '/pages/login/login' })
      })
  },

  /** 浮层吞掉点击，避免穿透到遮罩关闭。 */
  noop() {}
})
