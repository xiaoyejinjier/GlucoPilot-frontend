const { getUserInfo, saveUserInfo } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { persistShotImage } = require('../../utils/shot')

Page({
  data: {
    displayStyle: '',
    form: {}
  },

  onLoad() {
    const info = getUserInfo()
    this.setData({ form: { ...info } })
  },

  onShow() {
    applyDisplayToCurrentPage()
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
    const form = { ...this.data.form }
    delete form.avatarUrl
    form.avatarText = (form.nickname || '用').trim().charAt(0)
    this.setData({ form })
  },

  onSave() {
    const form = this.data.form
    if (!(form.nickname || '').trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    const payload = {
      ...form,
      age: parseInt(form.age, 10) || form.age,
      avatarText: (form.nickname || '用').trim().charAt(0)
    }
    if (!form.avatarUrl) {
      delete payload.avatarUrl
    }
    saveUserInfo(payload)
    wx.showToast({ title: '已保存', icon: 'none' })
    setTimeout(() => wx.navigateBack(), 600)
  }
})
