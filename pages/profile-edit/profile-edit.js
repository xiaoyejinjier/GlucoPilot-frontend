const { fetchMe, updateProfile, saveHealthProfile } = require('../../services/api')
const { getUserInfo, saveUserInfo } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { uploadMediaFile, BIZ_TYPE, MAX_IMAGE_BYTES } = require('../../utils/media')
const { getToken } = require('../../utils/request')
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
    saving: false, uploadingAvatar:false, avatarPreview:'', loading:true
  },

  current(token = this._profileToken) { return !this._disposed && !!token && token === getToken() && token === this._profileToken },
  onLoad() {
    this._disposed = false; this._profileToken = getToken(); this._dirty = new Set(); this._avatarChanged = false; this._diabetesChanged = false
    const token = this._profileToken
    this.setData({loading:true})
    const info = !this._skipCache && getUserInfo(); this._skipCache = false
    if (info) this.fill(info)
    fetchMe().then(me => {
      if (!this.current(token)) return
      saveUserInfo(me); this.fill(me)
    }).catch(err => { if(this.current(token)) wx.showToast({title:err.message || '资料加载失败',icon:'none'}) })
      .finally(()=>{if(this.current(token))this.setData({loading:false})})
  },
  onShow() {
    this._visible = true
    if (this._profileToken && this._profileToken !== getToken()) {
      this._uploadRun = (this._uploadRun || 0) + 1; this._skipCache = true
      this.setData({form:{},avatarPreview:'',uploadingAvatar:false,saving:false}); this.onLoad()
    }
    applyDisplayToCurrentPage()
  },
  onHide(){this._visible=false},
  onUnload(){this._disposed=true;this._visible=false;this._uploadRun=(this._uploadRun||0)+1;if(this._returnTimer)clearTimeout(this._returnTimer)},
  fill(info) {
    this._me = info
    const form={...info}
    for(const key of this._dirty || []) form[key]=this.data.form[key]
    if(this._avatarChanged)form.avatarUrl=this.data.form.avatarUrl
    this.setData({form,diabetesIndex:this._diabetesChanged?this.data.diabetesIndex:Math.max(0,diabetesCode(info.diabetesType))})
  },

  onField(e) {
    if(this.data.saving || !this.current())return
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    this._dirty.add(key)
    const form = { ...this.data.form, [key]: value }
    if (key === 'nickname' && value && !form.avatarUrl) {
      form.avatarText = value.trim().charAt(0)
    }
    this.setData({ form })
  },

  onDiabetesChange(e) {
    if(this.data.saving || !this.current())return
    this._diabetesChanged = true
    const index = Number(e.detail.value)
    this.setData({ diabetesIndex: index })
  },

  async onChooseAvatar() {
    if(!this.current() || this.data.saving || this.data.uploadingAvatar)return
    const token=this._profileToken,run=this._uploadRun=(this._uploadRun||0)+1
    const current=()=>this.current(token)&&run===this._uploadRun
    this.setData({uploadingAvatar:true})
    try {
      const selected=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:resolve,fail:reject}))
      const file=(selected.tempFiles||[])[0];if(!file || !current())return
      if(file.size>MAX_IMAGE_BYTES)throw new Error('头像不能超过5MB，请压缩后重试')
      this.setData({avatarPreview:file.tempFilePath})
      const media=await uploadMediaFile(BIZ_TYPE.AVATAR,file.tempFilePath,{maxBytes:MAX_IMAGE_BYTES,label:'头像',isCurrent:current})
      if(!current())return
      if(!media || !/^(?:https?:\/\/|\/api\/v1\/media-files\/avatars\/[1-9]\d{0,18}$)/.test(media.fileUrl || ''))throw new Error('头像上传未完成，请重新选择')
      this._avatarChanged=true
      this.setData({form:{...this.data.form,avatarUrl:media.fileUrl},avatarPreview:''})
    }catch(error){if(current()&&!/cancel/i.test(error.errMsg||''))wx.showToast({title:error.message||'头像上传失败，请重试',icon:'none'})}
    finally{if(current())this.setData({uploadingAvatar:false,avatarPreview:''})}
  },

  onClearAvatar() {
    if(!this.current() || this.data.saving || this.data.uploadingAvatar)return
    this._avatarChanged = true
    // 空串表示清空后端 avatar_url；省略字段则保持不变
    const form = { ...this.data.form, avatarUrl: '' }
    form.avatarText = (form.nickname || '用').trim().charAt(0)
    this.setData({ form })
  },

  onSave() {
    if (!this.current() || this.data.saving || this.data.uploadingAvatar || this.data.loading) return
    const token=this._profileToken
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

    return Promise.all([
      updateProfile({
        nickname: form.nickname.trim(),
        bio: (form.bio || '').trim(),
        ...(this._avatarChanged ? {avatarUrl:form.avatarUrl} : {}),
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
      .then(() => this.current(token) ? fetchMe() : null)
      .then((me) => {
        if(!me || !this.current(token))return
        saveUserInfo(me)
        this.setData({ saving: false })
        wx.showToast({ title: '已保存', icon: 'none' })
        this._returnTimer=setTimeout(() => {if(this.current(token)&&this._visible)wx.navigateBack()}, 600)
      })
      .catch((err) => {
        if(!this.current(token))return
        this.setData({ saving: false })
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
  }
})
