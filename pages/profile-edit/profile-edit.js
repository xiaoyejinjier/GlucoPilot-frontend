const { fetchMe, updateProfile, saveHealthProfile } = require('../../services/api')
const { getUserInfo, saveUserInfo } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { persistShotImage } = require('../../utils/shot')
const { DIABETES_TYPE_TEXT, diabetesCode } = require('../../utils/mappers')

// 将 2022.06 / 2022/06 / 2022年6月 / 202206 / 2022-6 统一归一化为 YYYY-MM
function normalizeYearMonth(raw) {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`
  if (digits.length === 5) return `${digits.slice(0, 4)}-0${digits.slice(4, 5)}`
  const matched = text.match(/^(\d{4})\D+(\d{1,2})/)
  if (matched) return `${matched[1]}-${matched[2].padStart(2, '0')}`
  return text
}

// 身高取整（cm）；空值返回 null
function toIntOrNull(raw) {
  if (raw === '' || raw == null) return null
  const n = parseInt(raw, 10)
  return isNaN(n) ? null : n
}

// 体重保留一位小数（kg）；空值返回 null
function toOneDecimalOrNull(raw) {
  if (raw === '' || raw == null) return null
  const n = Number(raw)
  return isNaN(n) ? null : Math.round(n * 10) / 10
}

Page({
  data: {
    displayStyle: '',
    form: {},
    diabetesOptions: DIABETES_TYPE_TEXT,
    diabetesIndex: 0,
    saving: false
  },

  onLoad() {
    const info = getUserInfo()
    if (info) {
      this.fill(info)
    }
    fetchMe()
      .then((me) => {
        saveUserInfo(me)
        this.fill(me)
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '资料加载失败', icon: 'none' })
      })
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  fill(info) {
    this._me = info
    this.setData({
      form: { ...this.data.form, ...info },
      diabetesIndex: Math.max(0, diabetesCode(info.diabetesType))
    })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const form = { ...this.data.form, [key]: value }
    if (key === 'nickname' && value && !form.avatarUrl) {
      form.avatarText = value.trim().charAt(0)
    }
    this.setData({ form })
  },

  onDiabetesChange(e) {
    const index = Number(e.detail.value)
    this.setData({ diabetesIndex: index })
  },

  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        persistShotImage(path).then((savedPath) => {
          const avatarUrl = savedPath || path
          this.setData({
            form: {
              ...this.data.form,
              avatarUrl
            }
          })
        })
      }
    })
  },

  onClearAvatar() {
    // 空串表示清空后端 avatar_url；省略字段则保持不变
    const form = { ...this.data.form, avatarUrl: '' }
    form.avatarText = (form.nickname || '用').trim().charAt(0)
    this.setData({ form })
  },

  onSave() {
    if (this.data.saving) return
    const form = this.data.form
    if (!(form.nickname || '').trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }

    const age = parseInt(form.age, 10)
    if (form.age !== '' && form.age != null && (isNaN(age) || age < 0 || age > 150)) {
      wx.showToast({ title: '年龄需在 0~150 之间', icon: 'none' })
      return
    }

    const height = toIntOrNull(form.height)
    if (height != null && (height < 50 || height > 250)) {
      wx.showToast({ title: '身高需在 50~250 cm 之间', icon: 'none' })
      return
    }

    const weight = toOneDecimalOrNull(form.weight)
    if (weight != null && (weight < 20 || weight > 300)) {
      wx.showToast({ title: '体重需在 20~300 kg 之间', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    const avatarText = (form.nickname || '用').trim().charAt(0)
    const confirmDate = normalizeYearMonth(form.confirmDate)
    // 回填归一化后的确诊时间，避免用户看到原始写法产生困惑
    if (confirmDate !== (form.confirmDate || null)) {
      this.setData({ form: { ...form, confirmDate: confirmDate || '' } })
    }

    Promise.all([
      updateProfile({
        nickname: form.nickname.trim(),
        avatarUrl: form.avatarUrl == null ? undefined : form.avatarUrl,
        avatarText
      }),
      saveHealthProfile({
        diabetesType: this.data.diabetesIndex,
        diagnosedYm: confirmDate,
        age: isNaN(age) ? null : age,
        medication: form.medication || null,
        exerciseHabit: form.exercise || null,
        height,
        weight,
        // 全量保存：未在表单暴露的目标值原样带回，避免被清空
        targetFasting: form.targetFasting == null ? null : form.targetFasting,
        targetPostprandial: form.targetPostprandial == null ? null : form.targetPostprandial
      })
    ])
      .then(() => fetchMe())
      .then((me) => {
        saveUserInfo(me)
        this.setData({ saving: false })
        wx.showToast({ title: '已保存', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
      })
      .catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
  }
})
