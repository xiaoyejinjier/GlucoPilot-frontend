const { applyDisplayToCurrentPage } = require('../../utils/display')
const api = require('../../services/api')

/**
 * 记忆键 → 展示文案。
 *
 * 键是后端 UserChatMemoryService.ALLOWED_KEYS 里的五类，**不要在这里发明新键**：
 * 展示层遇到不认识的键时退回原始键名（见 labelOf），既不会丢数据，
 * 也能一眼看出是后端加了新类型而前端还没跟上。
 */
const MEMORY_LABELS = {
  diet_taboo: '饮食忌口',
  glucose_goal: '控糖目标',
  health_context: '身体状况',
  habit: '生活习惯',
  preference: '偏好'
}

/**
 * 分类入口的图形。
 *
 * 用「一个字」而不是图标库/图片：小程序里加一套图标字体要多一份资源与一次维护，
 * 而五个类各自都有天然的单字（忌/标/身/习/偏），统一字号与底色后辨识度足够。
 * 不写 emoji：不同机型 emoji 字形差异大，入口会看起来忽大忽小。
 */
const MEMORY_GLYPHS = {
  diet_taboo: '忌',
  glucose_goal: '标',
  health_context: '身',
  habit: '习',
  preference: '偏'
}

/** 五个类的顺序：与后端展示顺序一致，不随"哪类先有记忆"跳动。 */
const MEMORY_KEYS = ['diet_taboo', 'glucose_goal', 'health_context', 'habit', 'preference']

/** 「全部」这一档的键；空串正好对上后端 memoryKey 留空 = 不限类。 */
const ALL_KEY = ''

/** 一页拉多少条。后端默认 20、上限 100；这里跟默认值对齐，翻页手感也不会太碎。 */
const PAGE_SIZE = 20

/** 后端 updatedAt 形如 2026-11-17T09:12:33；这里只到分钟，够用且省宽度。 */
function formatTime(iso) {
  if (!iso) return ''
  const text = String(iso).replace('T', ' ')
  return text.length >= 16 ? text.slice(0, 16) : text
}

function labelOf(key) {
  return MEMORY_LABELS[key] || key || ''
}

Page({
  data: {
    displayStyle: '',
    /**
     * 顶部分类入口：[{ key, label, glyph, tint, count }]。
     *
     * 第一个恒为「全部」（key 为空串），其余五类按固定顺序排列；
     * count 来自后端返回的 counts，与"当前在筛哪一类"无关——否则点进去之后别类的数字就清零了。
     */
    tiles: [],
    /** 当前筛选：'' = 全部，其余是某一类的 memoryKey */
    activeKey: ALL_KEY,
    /** 当前筛选的标题（全部 / 某一类的类名），wxml 直接用，避免模板里再查表 */
    activeLabel: '全部',
    /** 当前筛选下的条目：[{ id, key, label, text, timeText }] */
    items: [],
    /** 混合列表（全部）才显示类名小标签；只看某一类时标题已写明类名，卡片上再写一遍是噪音 */
    showTag: true,
    loaded: 0,
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    /** 首屏加载失败才整页报错；已经有内容时不覆盖列表 */
    error: ''
  },

  onShow() {
    applyDisplayToCurrentPage()
    // 每次回到本页都重取：用户可能刚在对话里让小语记了新东西
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  /**
   * 切换分类入口。
   *
   * 切换必须重取而不是在本地过滤：列表是分页的，本地只能过滤"已加载的那几页"，
   * 用户会以为某一类只有两条（后面其实还有三页）。
   */
  onPickCategory(event) {
    const key = event.currentTarget.dataset.key
    const next = key == null ? ALL_KEY : String(key)
    if (next === this.data.activeKey) return
    this._rows = []
    this._page = 1
    this._total = 0
    this.setData({
      activeKey: next,
      activeLabel: next === ALL_KEY ? '全部' : labelOf(next),
      showTag: next === ALL_KEY,
      items: [],
      loaded: 0,
      total: 0,
      hasMore: false,
      error: ''
    })
    this.load()
  },

  /** 首屏/刷新/切换分类：从第一页重来。 */
  load() {
    if (this.data.loading) return Promise.resolve(null)
    const version = (this._loadVersion = (this._loadVersion || 0) + 1)
    this._rows = []
    this._page = 1
    this.setData({ loading: true })
    return api
      .fetchAiMemories({ pageNum: 1, pageSize: PAGE_SIZE, memoryKey: this.data.activeKey })
      .then((result) => {
        if (version !== this._loadVersion) return null
        const records = (result && result.records) || []
        this._rows = records.map(toRow)
        this._page = 1
        this._total = Number((result && result.total) || records.length)
        this._counts = Object.assign({}, (result && result.counts) || {})
        this.setData(Object.assign({ loading: false, error: '' }, this.buildView()))
        return null
      })
      .catch((err) => {
        if (version !== this._loadVersion) return null
        this.setData({ loading: false, error: (err && err.message) || '记忆加载失败' })
        return null
      })
  },

  /** 触底加载下一页：失败不整页报错，只提示一次，用户可以再滑一次触发。 */
  loadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return Promise.resolve(null)
    const version = this._loadVersion
    // 页号必须自己记：用「已加载行数 / 每页条数」推会在最后一页不满时算错（3 条也是第 1 页）
    const nextPage = (this._page || 1) + 1
    this.setData({ loadingMore: true })
    return api
      .fetchAiMemories({ pageNum: nextPage, pageSize: PAGE_SIZE, memoryKey: this.data.activeKey })
      .then((result) => {
        if (version !== this._loadVersion) return null
        const records = (result && result.records) || []
        this._rows = this._rows.concat(records.map(toRow))
        this._page = nextPage
        this._total = Number((result && result.total) || this._rows.length)
        // counts 是全量统计，直接覆盖：累加会在翻页时把同一批数字重复加一遍
        this._counts = Object.assign({}, (result && result.counts) || this._counts || {})
        this.setData(Object.assign({ loadingMore: false }, this.buildView()))
        return null
      })
      .catch(() => {
        if (version !== this._loadVersion) return null
        this.setData({ loadingMore: false })
        wx.showToast({ title: '加载失败，请重试', icon: 'none' })
        return null
      })
  },

  onRetry() {
    this.setData({ error: '' })
    this.load()
  },

  /**
   * 删除一个条目。
   *
   * 传 id 而不是键：同一类下可以有多条（"不吃香菜"与"海鲜过敏"都算忌口），
   * 用键做参数只能整类删掉，用户会说"我只想删记错的那条"。
   */
  onDeleteTap(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除这条记忆',
      content: '删除后小语不会再据此回答。',
      confirmText: '删除',
      success: (res) => {
        if (!res || !res.confirm) return
        this.removeOne(id)
      }
    })
  },

  removeOne(id) {
    return api
      .deleteAiMemoryById(id)
      .then(() => {
        // 乐观移除：后端返回 deleted=0（别的端已经删了）也应当从列表消失
        const target = this._rows.find((row) => String(row.id) === String(id))
        this._rows = this._rows.filter((row) => String(row.id) !== String(id))
        this._total = Math.max(this._total - 1, 0)
        this._bumpCount(target && target.key, -1)
        this.setData(this.buildView())
        wx.showToast({ title: '已删除', icon: 'none' })
        return null
      })
      .catch(() => {
        wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        return null
      })
  },

  /** 清空一类：确认文案里带上类名，避免用户以为是"清空全部"。 */
  onClearGroup(event) {
    const key = event.currentTarget.dataset.key
    if (!key) return
    wx.showModal({
      // 标题不拼类名：i18n 是按整串查译文的，拼出来的串查不到，英文用户会看到中文标题
      title: '清空这一类记忆',
      content: '只会删掉这一类的全部记忆，其他类不受影响。',
      confirmText: '清空',
      success: (res) => {
        if (!res || !res.confirm) return
        api
          .deleteAiMemoriesByKey(key)
          .then(() => {
            const removed = this._rows.filter((row) => row.key === key)
            this._rows = this._rows.filter((row) => row.key !== key)
            this._total = Math.max(this._total - removed.length, 0)
            this._setCount(key, 0)
            this.setData(this.buildView())
            wx.showToast({ title: '已清空', icon: 'none' })
            return null
          })
          .catch(() => {
            wx.showToast({ title: '清空失败，请重试', icon: 'none' })
            return null
          })
      }
    })
  },

  /** 清空全部：没有记忆时不弹框（点了不会有任何变化，弹框只会打断用户）。 */
  onClearAll() {
    if (this.data.loaded === 0 && this.data.total === 0) return
    wx.showModal({
      title: '清空全部记忆',
      content: '清空后小语会忘记之前记住的所有事，操作不可撤销。',
      confirmText: '清空',
      success: (res) => {
        if (!res || !res.confirm) return
        api
          .deleteAllAiMemories()
          .then(() => {
            this._rows = []
            this._page = 1
            this._total = 0
            this._counts = {}
            this.setData(this.buildView())
            wx.showToast({ title: '已清空', icon: 'none' })
            return null
          })
          .catch(() => {
            wx.showToast({ title: '清空失败，请重试', icon: 'none' })
            return null
          })
      }
    })
  },

  // ------------------------------------------------------------ 内部状态

  _bumpCount(key, delta) {
    if (!key) return
    this._setCount(key, ((this._counts && this._counts[key]) || 0) + delta)
  },

  _setCount(key, value) {
    if (!this._counts) this._counts = {}
    this._counts[key] = Math.max(value, 0)
  },

  /**
   * 由内部状态拼出渲染用数据。
   *
   * 为什么不把 items/tiles 直接当状态累加：入口上的数字要的是"这一类一共有几条"（来自后端 counts），
   * 列表要的是"现在手里有几行"。两个量分开存、渲染时合并，
   * 删除/清空后才不会出现"入口数字变成已加载行数"这种错。
   */
  buildView() {
    const counts = this._counts || {}
    const tiles = [
      {
        key: ALL_KEY,
        label: '全部',
        glyph: '全',
        tint: 'tint-all',
        count: MEMORY_KEYS.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0)
      }
    ].concat(
      MEMORY_KEYS.map((key) => ({
        key,
        label: labelOf(key),
        glyph: MEMORY_GLYPHS[key] || '记',
        tint: 'tint-' + key.replace(/_/g, '-'),
        count: Number(counts[key]) || 0
      }))
    )
    const loaded = this._rows.length
    const items = this._rows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      text: row.text,
      timeText: row.timeText
    }))
    return {
      tiles,
      items,
      loaded,
      total: this._total,
      // 用 total 判断还有没有下一页；后端 total 缺失时退化成"本页是否满一页"
      hasMore: this._total > loaded || loaded === this._page * PAGE_SIZE
    }
  }
})

/** 后端行 → 页面内部行。id 保持字符串，避免大整数在 JS 里丢精度。 */
function toRow(record) {
  return {
    id: record.id,
    key: record.memoryKey,
    label: labelOf(record.memoryKey),
    text: record.memoryText || '',
    timeText: formatTime(record.updatedAt)
  }
}
