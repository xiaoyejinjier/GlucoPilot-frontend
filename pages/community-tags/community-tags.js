const api = require('../../services/api')
const social = require('../../utils/community')
const publication = require('../../utils/publication')
const tagHistory = require('../../utils/article-tags')
const tagImages = require('../../utils/tag-images')
const { applyDisplayToCurrentPage } = require('../../utils/display')

function isUser(tag){return tag && (tag.type==='USER' || String(tag.code||'').startsWith('custom_'))}
function rowKey(tag){return tag.code ? `c:${tag.code}` : `n:${String(tag.name).toLowerCase()}`}

Page({
  data: {
    displayStyle:'', mode:'browse', loading:false, error:'', editing:false,
    tags:[], frequentTags:[], catalogTags:[], input:'', slots:3, selectedCount:0
  },
  onLoad(options) {
    const mode = options.mode === 'pick' ? 'pick' : 'browse'
    const slots = Math.max(0, Math.min(3, Number(options.slots) || 3))
    this._seedSelected = new Set()
    this.setData({ mode, slots })
    try {
      const channel = typeof this.getOpenerEventChannel === 'function' && this.getOpenerEventChannel()
      if (channel && typeof channel.on === 'function') {
        channel.on('seed', seed => {
          if (!social.active(this)) return
          const codes = Array.isArray(seed && seed.tagCodes) ? seed.tagCodes : []
          const names = Array.isArray(seed && seed.customTags) ? seed.customTags : (Array.isArray(seed && seed.selected) ? seed.selected : [])
          this._seedSelected = new Set([
            ...codes.map(code => `c:${code}`),
            ...names.map(n => `n:${publication.normalizeTag(n).toLowerCase()}`).filter(k => k !== 'n:')
          ])
          if (seed && seed.slots != null) this.setData({ slots: Math.max(0, Math.min(3, Number(seed.slots) || 0)) })
          this.refreshSelection()
        })
      }
    } catch (_) { /* opener may already be gone */ }
  },
  onShow() {
    if (!getApp().checkLogin()) return
    social.begin(this); applyDisplayToCurrentPage(); this.load()
  },
  onHide() { social.end(this) },
  onUnload() { this.onHide() },
  async onPullDownRefresh() { try { await this.load() } finally { wx.stopPullDownRefresh() } },
  channel() {
    try { return typeof this.getOpenerEventChannel === 'function' ? this.getOpenerEventChannel() : null } catch (_) { return null }
  },
  emit(name, payload) {
    const channel = this.channel()
    if (channel && typeof channel.emit === 'function') channel.emit(name, payload)
  },
  onToggleEdit() { this.setData({ editing:!this.data.editing }) },
  async load() {
    if (!social.active(this)) return
    const version = this._communityVersion, run = this._loadRun = (this._loadRun || 0) + 1
    this.setData({ loading:true, error:'' })
    try {
      const [catalog, mine] = await Promise.all([api.fetchCommunityTags(), api.fetchMyCommunityTags(true)])
      if (!social.active(this, version) || run !== this._loadRun) return
      if (!Array.isArray(catalog) || !Array.isArray(mine)) throw Error('标签加载失败，点击重试')
      const blocked = new Set([
        ...mine.filter(t => t.enabled === 0).map(t => String(t.name).toLowerCase()),
        ...tagHistory.hidden().map(n => n.toLowerCase())
      ])
      tagHistory.forget([...blocked])
      const byCode = new Map()
      const byName = new Map()
      const push = (tag, deletable) => {
        if (!tag || !tag.name || blocked.has(String(tag.name).toLowerCase())) return
        if (tag.enabled === 0) return
        const row = {
          key: rowKey(tag),
          code: tag.code || '',
          name: tag.name,
          type: isUser(tag) || !tag.code ? 'USER' : 'OFFICIAL',
          deletable: !!deletable,
          selected: false,
          pinned: false,
          icon: ''
        }
        row.icon = tagImages.resolve(row)
        if (row.code) byCode.set(row.code, row)
        byName.set(row.name.toLowerCase(), row)
      }
      catalog.filter(t => t && t.enabled !== 0).forEach(t => push(t, isUser(t)))
      mine.filter(t => t.enabled !== 0 && isUser(t)).forEach(t => {
        if (!byCode.has(t.code) && !byName.has(String(t.name).toLowerCase())) push(t, true)
      })
      tagHistory.list().forEach(name => {
        const key = name.toLowerCase()
        if (blocked.has(key) || byName.has(key)) return
        push({ name, code:'' }, true)
      })
      const official = []
      const custom = []
      const seen = new Set()
      ;[...byCode.values(), ...byName.values()].forEach(row => {
        if (seen.has(row.key)) return
        seen.add(row.key)
        if (row.type === 'USER' || row.deletable) custom.push(row)
        else official.push(row)
      })
      official.sort((a, b) => {
        if (a.code === 'other') return 1
        if (b.code === 'other') return -1
        return a.name.localeCompare(b.name, 'zh')
      })
      custom.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      // Same as homepage topic bar: non-USER official rows (incl. other).
      this._homeOfficial = official.slice()
      this._rows = [...official, ...custom]
      this.setData({ loading:false, error:'' }); this.refreshSelection()
    } catch (error) {
      if (social.active(this, version) && run === this._loadRun) this.setData({ loading:false, error:error.message || '标签加载失败，点击重试', tags:[], frequentTags:[], catalogTags:[] })
    }
  },
  isSelected(tag, selected) {
    return selected.has(tag.key) || selected.has(`n:${tag.name.toLowerCase()}`)
  },
  refreshSelection() {
    const selected = this._seedSelected || new Set()
    const tags = (this._rows || []).map(tag => ({ ...tag, selected: this.isSelected(tag, selected) }))
    tags.forEach(tag => {
      if (!tag.selected && tag.code && selected.has(`n:${tag.name.toLowerCase()}`)) {
        selected.delete(`n:${tag.name.toLowerCase()}`)
        selected.add(tag.key)
        tag.selected = true
      }
    })
    this._seedSelected = selected
    this.setData({ tags, selectedCount: tags.filter(t => t.selected).length })
    this.applyLists()
  },
  applyLists() {
    const tags = this.data.tags || []
    const byKey = new Map(tags.map(t => [t.key, t]))
    const unpinned = new Set(tagHistory.unpinned().map(n => n.toLowerCase()))
    const recent = new Set(tagHistory.list().map(n => n.toLowerCase()))
    const home = (this._homeOfficial || [])
      .filter(t => !unpinned.has(t.name.toLowerCase()))
      .map(t => byKey.get(t.key) || t)
    const homeKeys = new Set(home.map(t => t.key))
    const extras = tags.filter(t => {
      if (homeKeys.has(t.key)) return false
      if (t.deletable || t.type === 'USER') return recent.has(t.name.toLowerCase()) || t.selected
      return this.data.mode === 'pick' && t.selected
    })
    const frequentTags = [...home, ...extras].map(t => ({ ...t, pinned:true }))
    const frequentKeys = new Set(frequentTags.map(t => t.key))
    const catalogTags = tags.map(t => ({ ...t, pinned: frequentKeys.has(t.key) }))
    this.setData({ catalogTags, frequentTags })
  },
  onInput(e) { this.setData({ input:e.detail.value }) },
  onRemoveFrequent(e) {
    const key = e.currentTarget.dataset.key
    const row = (this._rows || []).find(t => t.key === key)
    if (!row || !social.active(this)) return
    const version = this._communityVersion
    if (row.deletable) {
      wx.showModal({
        title:'删除标签',
        content:`删除“${row.name}”后，本机不再显示；已发布文章仍保留该标签。确定删除吗？`,
        confirmColor:'#ad7241',
        success: result => {
          if (!result.confirm || !social.active(this, version)) return
          tagHistory.hide([row.name])
          if (this._seedSelected) {
            this._seedSelected.delete(row.key)
            this._seedSelected.delete(`n:${row.name.toLowerCase()}`)
          }
          this.load()
        }
      })
      return
    }
    tagHistory.unpin([row.name])
    if (this._seedSelected) {
      this._seedSelected.delete(row.key)
      this._seedSelected.delete(`n:${row.name.toLowerCase()}`)
    }
    this.refreshSelection()
  },
  onAddFrequent(e) {
    const key = e.currentTarget.dataset.key
    const row = (this._rows || []).find(t => t.key === key)
    if (!row || !social.active(this)) return
    tagHistory.repin([row.name])
    if (this.data.mode === 'pick') {
      if (!this._seedSelected) this._seedSelected = new Set()
      if (!this.isSelected(row, this._seedSelected)) {
        if (this._seedSelected.size >= this.data.slots) {
          this.refreshSelection()
          return wx.showToast({ title:`最多选择${this.data.slots}个标签`, icon:'none' })
        }
        this._seedSelected.add(row.key)
      }
    }
    this.refreshSelection()
  },
  onSave() {
    if (!social.active(this)) return
    const name = publication.normalizeTag(this.data.input), issue = publication.tagIssue(name)
    if (issue) return wx.showToast({ title:issue, icon:'none' })
    const key = `n:${name.toLowerCase()}`
    if ((this._rows || []).some(t => t.name.toLowerCase() === name.toLowerCase())) {
      if (this.data.mode === 'pick') {
        if (!this._seedSelected) this._seedSelected = new Set()
        const existing = (this._rows || []).find(t => t.name.toLowerCase() === name.toLowerCase())
        const selectKey = existing ? existing.key : key
        if (!this._seedSelected.has(selectKey) && this._seedSelected.size >= this.data.slots) {
          return wx.showToast({ title:`最多选择${this.data.slots}个标签`, icon:'none' })
        }
        this._seedSelected.add(selectKey)
      }
      tagHistory.repin([name])
      this.setData({ input:'' }); this.refreshSelection(); return wx.showToast({ title:'这个标签已经有了', icon:'none' })
    }
    tagHistory.unhide([name]); tagHistory.remember([name])
    if (this.data.mode === 'pick') {
      if (!this._seedSelected) this._seedSelected = new Set()
      if (this._seedSelected.size >= this.data.slots) {
        this.setData({ input:'' }); this.load()
        return wx.showToast({ title:`最多选择${this.data.slots}个标签`, icon:'none' })
      }
      this._seedSelected.add(key)
    }
    this.setData({ input:'' }); this.load(); wx.showToast({ title:'已添加', icon:'success' })
  },
  onTapFrequent(e) {
    if (this.data.editing) return
    this.onTapTag(e)
  },
  onTapTag(e) {
    if (this.data.editing) return
    const key = e.currentTarget.dataset.key
    const row = (this._rows || []).find(t => t.key === key)
    if (!row || !social.active(this)) return
    if (this.data.mode === 'pick') {
      if (!this._seedSelected) this._seedSelected = new Set()
      if (this._seedSelected.has(key) || this._seedSelected.has(`n:${row.name.toLowerCase()}`)) {
        this._seedSelected.delete(key)
        this._seedSelected.delete(`n:${row.name.toLowerCase()}`)
      } else if (this._seedSelected.size >= this.data.slots) {
        return wx.showToast({ title:`最多选择${this.data.slots}个标签`, icon:'none' })
      } else this._seedSelected.add(key)
      tagHistory.remember([row.name])
      this.refreshSelection()
      return
    }
    const code = row.code || (row.type === 'USER' ? 'other' : '')
    this.emit('filterTag', { code: code || 'other', name: row.name })
    wx.navigateBack({ fail:() => wx.switchTab({ url:'/pages/index/index' }) })
  },
  onBrowseAll() {
    if (this.data.mode !== 'browse' || !social.active(this)) return
    this.emit('filterTag', { code:'other', name:'其他' })
    wx.navigateBack({ fail:() => wx.switchTab({ url:'/pages/index/index' }) })
  },
  onConfirm() {
    if (this.data.mode !== 'pick' || !social.active(this)) return
    const selected = (this._rows || []).filter(t => this._seedSelected && this.isSelected(t, this._seedSelected))
    const tagCodes = selected.filter(t => t.code).map(t => t.code)
    const customTags = selected.filter(t => !t.code).map(t => t.name)
    this.emit('confirmTags', { tagCodes, customTags, names: selected.map(t => t.name) })
    wx.navigateBack({ fail:() => {} })
  }
})
