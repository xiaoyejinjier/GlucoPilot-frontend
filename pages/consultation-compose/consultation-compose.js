const api = require('../../services/consultation')
const social = require('../../utils/community')
const { attemptId, preview } = require('../../utils/consultation')
const topicSettings = require('../../utils/consultation-topics')
const { getToken } = require('../../utils/request')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { uploadMediaFile, BIZ_TYPE, MAX_IMAGE_BYTES } = require('../../utils/media')

function emptyForm() { return { title: '', topic: 'GLUCOSE', symptoms: '', glucoseNote: '', medicationNote: '', anonymous: true } }
Page({
  data: { displayStyle: '', topics: [], topicLabel: '血糖波动', topicLoading: true, topicError: '', form: emptyForm(),
    capabilities: api.PREVIEW_CAPABILITIES, saving: false, error: '', images: [], uploading: false },
  onShow() {
    if (!getApp().checkLogin()) return
    if (this._token && this._token !== getToken()) { this._requestId = ''; this._uploadRun=(this._uploadRun||0)+1; this.setData({ form: emptyForm(), error: '', images:[], uploading:false }) }
    this.setData({ saving: false })
    this._token = getToken(); social.begin(this); applyDisplayToCurrentPage()
    this.loadTopics()
    const version = this._communityVersion
    api.capabilities().then(capabilities => {
      if (social.active(this, version)) this.setData({ capabilities })
    }).catch(() => {})
  },
  async loadTopics() {
    const version = this._communityVersion, run = this._topicRun = (this._topicRun || 0) + 1
    this.setData({topicLoading:true, topicError:''})
    try {
      const topics = topicSettings.normalize(await api.topics())
      if (!social.active(this, version) || run !== this._topicRun) return
      const selected = topics.find(item => item.code === this.data.form.topic)
      this.setData({topics, topicLabel: selected ? selected.name : '', topicLoading:false})
    } catch (error) {
      if (!social.active(this, version) || run !== this._topicRun) return
      this.setData({topicLoading:false, topicError:error.message || '标签加载失败，点击重试'})
      social.failure(this, error, version)
    }
  },
  onChooseTopic() {
    if (!social.active(this) || this.data.saving) return
    const token = getToken()
    wx.navigateTo({url:`/pages/consultation-topics/consultation-topics?mode=pick&selected=${encodeURIComponent(this.data.form.topic)}`,
      events:{selectTopic:item=>{
        if (this._disposed || getToken() !== token) return
        this._requestId = ''
        this.setData({'form.topic':item.code, topicLabel:item.name})
      }}})
  },
  onHide() { social.end(this) },
  onUnload() { this._disposed=true;this.onHide() },
  async onAddImage() {
    if(!social.active(this)||this.data.saving||this.data.uploading||this.data.images.length>=6)return
    const token=getToken(),run=this._uploadRun=(this._uploadRun||0)+1
    const current=()=>!this._disposed&&getToken()===token&&run===this._uploadRun
    this.setData({uploading:true})
    try {
      const selected=await new Promise((resolve,reject)=>wx.chooseMedia({count:6-this.data.images.length,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:resolve,fail:reject}))
      for(const file of selected.tempFiles||[]) {
        if(!current())return
        const saved=await uploadMediaFile(BIZ_TYPE.CONSULTATION_IMAGE,file.tempFilePath,{maxBytes:MAX_IMAGE_BYTES,label:'问诊图片'})
        if(!current())return
        if(!this.data.images.some(row=>row.mediaId===String(saved.id))) {
          this._requestId='';this.setData({images:[...this.data.images,{mediaId:String(saved.id),url:file.tempFilePath}]})
        }
      }
    } catch(error){if(current()&&!/cancel/i.test(error.errMsg||''))wx.showToast({title:error.message||'图片上传失败，请重试',icon:'none'})}
    finally{if(current())this.setData({uploading:false})}
  },
  onRemoveImage(event){if(this.data.saving||this.data.uploading)return;this._requestId='';this.setData({images:this.data.images.filter(row=>row.mediaId!==String(event.currentTarget.dataset.id))})},
  onPreviewImage(event){const urls=this.data.images.map(row=>row.url);if(urls.length)wx.previewImage({urls,current:event.currentTarget.dataset.url})},
  onInput(event) {
    if (this.data.saving) return
    const field = event.currentTarget.dataset.field
    if (!['title', 'symptoms', 'glucoseNote', 'medicationNote'].includes(field)) return
    this._requestId = ''; this.setData({ [`form.${field}`]: event.detail.value, error: '' })
  },
  onTopic(event) {
    if (this.data.saving) return
    const topic = event.currentTarget.dataset.code
    if (this.data.topics.some(item => item.code === topic)) { this._requestId = ''; this.setData({ 'form.topic': topic, topicLabel: this.data.topics.find(item => item.code === topic).name }) }
  },
  onAnonymous(event) { if (!this.data.saving) { this._requestId = ''; this.setData({ 'form.anonymous': !!event.detail.value }) } },
  showSubmissionError(error) {
    const version = this._communityVersion
    const run = this._errorScrollRun = (this._errorScrollRun || 0) + 1
    wx.hideKeyboard()
    // 等底部提示渲染完成再定位，避免滚动时提示尚未出现。
    this.setData({ error }, () => {
      wx.nextTick(() => {
        if (!social.active(this, version) || run !== this._errorScrollRun || this.data.error !== error) return
        wx.pageScrollTo({ selector: '#consultation-submit-error', duration: 250 })
      })
    })
  },
  validate() {
    if (this.data.form.title.trim().length < 4) { this.showSubmissionError('请用至少4个字概括你的问题'); return false }
    if (this.data.form.symptoms.trim().length < 10) { this.showSubmissionError('请补充至少10个字的问题描述'); return false }
    if (this.data.topicLoading || this.data.topicError || !this.data.topics.some(item => item.code === this.data.form.topic)) {
      this.showSubmissionError('请选择有效的问题分类，或重新加载标签'); return false
    }
    return true
  },
  onPreview() {
    if (!social.active(this) || !this.validate()) return
    const token = getToken(), item = preview(this.data.form)
    item.topicName = this.data.topicLabel
    item.imagePreviews=this.data.images
    wx.navigateTo({ url: '/pages/consultation-detail/consultation-detail?preview=1', success: result => {
      if (getToken() === token) result.eventChannel.emit('consultationPreview', item)
    } })
  },
  async onSubmit() {
    if (!social.active(this) || this.data.saving || this.data.uploading || !this.validate()) return
    if (!this.data.capabilities.submissionEnabled) {
      const token = getToken()
      wx.showModal({ title: '问诊服务筹备中', content: '发布功能开放后即可提交求助。当前内容尚未发布，你可以先查看预览。',
        confirmText: '查看预览', success: result => {
          if (result.confirm && getToken() === token && social.active(this)) this.onPreview()
        } })
      return
    }
    const version = this._communityVersion
    this._requestId = this._requestId || attemptId()
    this.setData({ saving: true, error: '' })
    try {
      await api.publish({ ...this.data.form, imageMediaIds:this.data.images.map(row=>row.mediaId), clientRequestId: this._requestId })
      if (social.active(this, version)) {
        this.setData({ form: emptyForm(), images:[] }); wx.redirectTo({ url: '/pages/consultation-records/consultation-records' })
      }
    } catch (error) {
      if (social.active(this, version)) { this.showSubmissionError(error.message || '发布暂不可用，填写内容已保留'); social.failure(this, error, version) }
    } finally { if (social.active(this, version)) this.setData({ saving: false }) }
  }
})
