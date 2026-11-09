const api = require('../../services/api')
const { mapField } = require('../../utils/remote-image')
const social = require('../../utils/community')
const history = require('../../utils/community-search-history')
const { highlightTitle } = require('../../utils/title-pinyin')

function splitHotColumns(rows) {
  const left = []
  const right = []
  rows.forEach((item, index) => {
    const row = { ...item, rank: index + 1 }
    if (index < 5) left.push(row)
    else right.push(row)
  })
  return { left, right }
}

Component({
  properties: {
    active: { type: Boolean, value: false },
    showClose: { type: Boolean, value: false },
    embedded: { type: Boolean, value: false },
    initialKeyword: { type: String, value: '' }
  },

  data: {
    keyword: '',
    panel: 'landing',
    history: [],
    hotLeft: [],
    hotRight: [],
    hotLoading: false,
    hotError: '',
    suggests: [],
    suggestLoading: false,
    suggestEmpty: false,
    results: [],
    resultLoading: false,
    resultError: '',
    pageNum: 0,
    hasMore: false,
    inputFocus: false,
    contentTranslations: {}
  },

  observers: {
    active(open) {
      if (open) this.openPanel()
      else this.closePanel()
    },
    initialKeyword(q) {
      if (!this.properties.active && !this.properties.embedded) return
      const keyword = history.normalize(q)
      if (!keyword || keyword === this.data.keyword) return
      this.setData({ keyword })
      this.runSearch(keyword)
    }
  },

  lifetimes: {
    attached() {
      social.begin(this)
      this.setData({ history: history.list() })
      // 遮罩态等 active=true 再开；独立搜索页初始即 active，这里打开一次即可
      if (!this.properties.embedded && this.properties.active) this.openPanel()
    },
    detached() {
      social.end(this)
      this._suggestTimer && clearTimeout(this._suggestTimer)
    }
  },

  pageLifetimes: {
    show() {
      if (!getApp().checkLogin()) return
      social.begin(this)
      this.setData({ history: history.list() })
      this.syncTranslations()
    },
    hide() {
      // 遮罩挂在首页上时，跳转详情会触发 page hide；不要 end 掉组件会话，否则热帖回包会被丢弃
      if (this.properties.embedded && this.properties.active) return
      social.end(this)
    }
  },

  methods: {
    syncTranslations() {
      try {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && page.data && page.data.contentTranslations) {
          this.setData({ contentTranslations: page.data.contentTranslations })
        }
      } catch (_) {}
    },

    openPanel() {
      // 避免 attached/active 交错时多次 begin 抬版本，把进行中的热帖请求静默丢弃
      if (this._panelSession === this._communityVersion && (this.data.hotLoading || this.data.hotLeft.length)) {
        this.setData({ inputFocus: true })
        return
      }
      social.begin(this)
      this._panelSession = this._communityVersion
      const q = history.normalize(this.properties.initialKeyword)
      this.setData({
        history: history.list(),
        inputFocus: false,
        keyword: q || this.data.keyword,
        ...(q ? {} : {
          panel: this.data.panel === 'result' && this.data.keyword ? 'result' : 'landing'
        })
      })
      if (q) this.runSearch(q)
      else if (!this.data.hotLeft.length) this.loadHot()
      setTimeout(() => {
        if (this.properties.active || !this.properties.embedded) this.setData({ inputFocus: true })
      }, 220)
    },

    closePanel() {
      this._panelSession = null
      this._suggestTimer && clearTimeout(this._suggestTimer)
      this._suggestRun = (this._suggestRun || 0) + 1
      this._hotRun = (this._hotRun || 0) + 1
      this.setData({ inputFocus: false, hotLoading: false })
    },

    onClose() {
      this.triggerEvent('close')
    },

    async loadHot() {
      const version = this._communityVersion
      const run = this._hotRun = (this._hotRun || 0) + 1
      this.setData({ hotLoading: true, hotError: '' })
      try {
        const page = await api.fetchHotArticles({ limit: 10 })
        if (run !== this._hotRun) return
        if (!social.active(this, version)) {
          this.setData({ hotLoading: false })
          return
        }
        const records = (page.records || []).map((item, index) => ({
          id: item.id,
          title: item.title || '',
          rank: index + 1
        }))
        const cols = splitHotColumns(records)
        this.setData({ hotLeft: cols.left, hotRight: cols.right, hotLoading: false })
      } catch (error) {
        if (run !== this._hotRun) return
        if (!social.active(this, version, error)) {
          this.setData({ hotLoading: false })
          return
        }
        this.setData({ hotLoading: false, hotError: error.message || '热帖加载失败', hotLeft: [], hotRight: [] })
        if (error.code === 40100) social.failure(this, error, version)
      }
    },

    onInput(e) {
      const keyword = String((e.detail && e.detail.value) || '').slice(0, 80)
      this.setData({ keyword })
      this._suggestTimer && clearTimeout(this._suggestTimer)
      const trimmed = history.normalize(keyword)
      if (!trimmed) {
        this._suggestRun = (this._suggestRun || 0) + 1
        this.setData({ panel: 'landing', suggests: [], suggestEmpty: false, suggestLoading: false })
        if (!this.data.hotLeft.length) this.loadHot()
        return
      }
      this.setData({ panel: 'suggest', suggestLoading: true, suggestEmpty: false, results: [] })
      this._suggestTimer = setTimeout(() => this.loadSuggests(trimmed), 200)
    },

    async loadSuggests(keyword) {
      const version = this._communityVersion
      const run = this._suggestRun = (this._suggestRun || 0) + 1
      try {
        const page = await api.fetchCommunityArticles({
          pageNum: 1,
          pageSize: 10,
          keyword,
          sort: 'LATEST'
        })
        if (!social.active(this, version) || run !== this._suggestRun) return
        if (history.normalize(this.data.keyword) !== keyword) return
        const suggests = (page.records || []).map(item => ({
          id: item.id,
          title: item.title || '',
          ...highlightTitle(item.title || '', keyword)
        }))
        this.setData({
          suggests,
          suggestLoading: false,
          suggestEmpty: !suggests.length,
          panel: 'suggest'
        })
      } catch (error) {
        if (!social.active(this, version, error) || run !== this._suggestRun) return
        this.setData({ suggests: [], suggestLoading: false, suggestEmpty: true })
        if (error.code === 40100) social.failure(this, error, version)
      }
    },

    onClearInput() {
      this._suggestTimer && clearTimeout(this._suggestTimer)
      this._suggestRun = (this._suggestRun || 0) + 1
      this.setData({
        keyword: '',
        panel: 'landing',
        suggests: [],
        suggestEmpty: false,
        suggestLoading: false,
        results: [],
        resultError: '',
        inputFocus: true
      })
      if (!this.data.hotLeft.length) this.loadHot()
    },

    onClearHistory() {
      this.setData({ history: history.clear() })
    },

    onTapHistory(e) {
      const keyword = history.normalize(e.currentTarget.dataset.keyword)
      if (!keyword) return
      this.setData({ keyword })
      this.runSearch(keyword)
    },

    onTapSuggest(e) {
      const title = history.normalize(e.currentTarget.dataset.title)
      if (!title) return
      this.setData({ keyword: title })
      this.runSearch(title)
    },

    onConfirmSearch() {
      const keyword = history.normalize(this.data.keyword)
      if (!keyword) {
        wx.showToast({ title: '请输入搜索词', icon: 'none' })
        return
      }
      this.runSearch(keyword)
    },

    runSearch(keyword) {
      const text = history.normalize(keyword)
      if (!text) return
      this._suggestTimer && clearTimeout(this._suggestTimer)
      this._suggestRun = (this._suggestRun || 0) + 1
      this.setData({
        keyword: text,
        panel: 'result',
        history: history.push(text),
        suggests: [],
        suggestLoading: false,
        results: [],
        pageNum: 0,
        hasMore: false,
        resultError: ''
      })
      this.loadResults(true)
    },

    async loadResults(reset) {
      if (!social.active(this) || (!reset && (this.data.resultLoading || !this.data.hasMore))) return
      const keyword = history.normalize(this.data.keyword)
      if (!keyword) return
      const version = this._communityVersion
      const run = this._resultRun = (this._resultRun || 0) + 1
      const pageNum = reset ? 1 : this.data.pageNum + 1
      this.setData({ resultLoading: true, resultError: '' })
      try {
        const page = await api.fetchCommunityArticles({
          pageNum,
          pageSize: 15,
          keyword,
          sort: 'LATEST'
        })
        if (!social.active(this, version) || run !== this._resultRun) return
        const records = (await mapField(page.records || [], 'cover')).map(item => ({
          ...item,
          images: item.images || [],
          videos: item.videos || [],
          tags: item.tags || [],
          timeLabel: social.timeLabel(item.publishAt || item.createdAt)
        }))
        if (!social.active(this, version) || run !== this._resultRun) return
        const map = new Map((reset ? [] : this.data.results).map(row => [row.id, row]))
        records.forEach(row => map.set(row.id, row))
        this.setData({
          results: Array.from(map.values()),
          pageNum,
          hasMore: pageNum < Number(page.pages),
          resultLoading: false
        })
        this.syncTranslations()
      } catch (error) {
        if (!social.active(this, version, error) || run !== this._resultRun) return
        this.setData({
          resultLoading: false,
          resultError: error.message || '搜索失败，请重试',
          ...(reset ? { results: [], hasMore: false } : {})
        })
        if (error.code === 40100) social.failure(this, error, version)
      }
    },

    onReachBottom() {
      if (this.data.panel === 'result') this.loadResults(false)
    },

    onRetryHot() { this.loadHot() },
    onRetryResult() { this.loadResults(true) },
    onMoreResults() { this.loadResults(false) },

    onOpenHot(e) {
      const id = String(e.currentTarget.dataset.id || '')
      if (/^[1-9]\d{0,18}$/.test(id)) wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${id}` })
    },

    onOpenResult(e) {
      const id = String(e.currentTarget.dataset.id || '')
      if (/^[1-9]\d{0,18}$/.test(id)) wx.navigateTo({ url: `/pages/news-detail/news-detail?id=${id}` })
    }
  }
})
