const api = require('../../services/consultation')
const settings = require('../../utils/consultation-topics')
const social = require('../../utils/community')
const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle:'', mode:'browse', selected:'', catalog:[], frequent:[], groups:[], query:'', editing:false, loading:true, error:'' },
  onLoad(options = {}) {
    this.setData({mode:options.mode === 'pick' ? 'pick' : 'browse', selected:options.selected || ''})
  },
  onShow() {
    if (!getApp().checkLogin()) return
    const previous = this._communityToken
    social.begin(this); applyDisplayToCurrentPage()
    this._returning = false
    if (previous && previous !== this._communityToken) this.setData({selected:'',query:'',editing:false,catalog:[],frequent:[],groups:[]})
    this.load()
  },
  onHide() { this._topicPrompt = null; social.end(this) },
  onUnload() { this.onHide() },
  async load() {
    const version = this._communityVersion, run = this._run = (this._run || 0) + 1
    this.setData({loading:true,error:''})
    try {
      const catalog = settings.normalize(await api.topics())
      if (!social.active(this,version) || run !== this._run) return
      this.setData({catalog,loading:false}); this.render()
    } catch (error) {
      if (!social.active(this,version) || run !== this._run) return
      this.setData({loading:false,error:error.message || '标签加载失败，点击重试'})
      social.failure(this,error,version)
    }
  },
  render() {
    const frequent = settings.read(this.data.catalog), codes = new Set(frequent.map(item=>item.code))
    const query = this.data.query.trim().toLowerCase(), groups = []
    this.data.catalog.forEach(item=>{
      if (query && !`${item.name} ${item.groupName}`.toLowerCase().includes(query)) return
      let group = groups.find(row=>row.name === item.groupName)
      if (!group) { group = {name:item.groupName,items:[]}; groups.push(group) }
      group.items.push({...item,frequent:codes.has(item.code)})
    })
    this.setData({frequent,groups})
  },
  onSearch(event) { this.setData({query:event.detail.value}); this.render() },
  onEdit() { if (social.active(this)) this.setData({editing:!this.data.editing}) },
  onReset() {
    if (!social.active(this)) return
    try { settings.reset(this.data.catalog); this.render() }
    catch (_) { wx.showToast({title:'保存失败，请重试',icon:'none'}) }
  },
  onToggleFavorite(event) {
    if (!social.active(this) || !this.data.editing || this.data.loading || this.data.error || this._topicPrompt || this._returning) return
    const code = event.currentTarget.dataset.code
    const item = this.data.catalog.find(row=>row.code === code)
    if (!item) return
    const codes = settings.read(this.data.catalog).map(row=>row.code)
    const next = codes.includes(code) ? codes.filter(value=>value !== code) : [...codes,code]
    try { settings.save(next); this.render() }
    catch (_) { wx.showToast({title:'保存失败，请重试',icon:'none'}) }
  },
  onTag(event) {
    if (!social.active(this) || this.data.loading || this.data.error || this._topicPrompt || this._returning) return
    const code = event.currentTarget.dataset.code
    const item = this.data.catalog.find(row=>row.code === code)
    if (!item && !(code === '' && this.data.mode === 'browse')) return
    if (item && this.data.mode === 'browse' && !settings.read(this.data.catalog).some(row=>row.code === code)) {
      const version = this._communityVersion, scope = settings.scope()
      const prompt = { code, version, scope }
      this._topicPrompt = prompt
      wx.showModal({
        title: '添加常用标签',
        content: '该标签还不在常用标签中，是否添加后查看相关求助？',
        confirmText: '添加查看',
        success: result => {
          if (this._topicPrompt !== prompt) return
          this._topicPrompt = null
          if (!result.confirm || !social.active(this, version) || settings.scope() !== scope || this.data.loading || this.data.error) return
          const current = this.data.catalog.find(row=>row.code === code)
          if (!current) { wx.showToast({title:'标签已更新，请重新选择',icon:'none'}); return }
          try {
            const codes = settings.read(this.data.catalog).map(row=>row.code)
            settings.save([...codes, code])
            if (!settings.read(this.data.catalog).some(row=>row.code === code)) throw new Error('not saved')
            this.render()
            this.selectTopic(current)
          } catch (_) { wx.showToast({title:'保存失败，请重试',icon:'none'}) }
        },
        fail: () => { if (this._topicPrompt === prompt) this._topicPrompt = null }
      })
      return
    }
    this.selectTopic(item)
  },
  selectTopic(item) {
    if (!social.active(this) || this._returning) return
    this._returning = true
    this.getOpenerEventChannel().emit('selectTopic', item || {code:'',name:'全部求助'})
    const version = this._communityVersion
    wx.navigateBack({ fail: () => { if (social.active(this,version)) this._returning = false } })
  },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } }
})
