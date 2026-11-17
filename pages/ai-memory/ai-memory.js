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
     * 按类分组后的视图：每项 { key, label, count, items: [{ id, text, timeText }] }。
     *
     * 为什么在页面里分组而不是让后端分组：后端分页是按 (memory_key asc, gmt_modified desc) 排的，
     * 同一类可能跨页；分组只看当前已加载的行，分页语义才不会被前端改写。
     */
    groups: [],
    /** 已加载的条目总数（当前页之前的都算），用来判断"还有更多"*/
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

  /** 首屏/刷新：从第一页重来。 */
  load() {
    if (this.data.loading) return Promise.resolve(null)
    const version = (this._loadVersion = (this._loadVersion || 0) + 1)
    this._rows = []
    this.setData({ loading: true })
    return api
      .fetchAiMemories({ pageNum: 1, pageSize: PAGE_SIZE })
      .then((result) => {
        if (version !== this._loadVersion) return null
        const records = (result && result.records) || []
        this._rows = records.map(toRow)
        this.setData({
          loading: false,
          error: '',
          ...buildView(this._rows, Number((result && result.total) || records.length), this._page)
        })
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
      .fetchAiMemories({ pageNum: nextPage, pageSize: PAGE_SIZE })
      .then((result) => {
        if (version !== this._loadVersion) return null
        const records = (result && result.records) || []
        this._rows = this._rows.concat(records.map(toRow))
        this._page = nextPage
        this.setData({
          loadingMore: false,
          ...buildView(this._rows, Number((result && result.total) || this._rows.length), nextPage)
        })
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
   * 传 id 而不是键：同一类下现在可以有多条（"不吃香菜"与"海鲜过敏"都算忌口），
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
        this._rows = this._rows.filter((row) => String(row.id) !== String(id))
        this.setData(buildView(this._rows, Math.max(this.data.total - 1, this._rows.length),
          Math.floor(this._rows.length / PAGE_SIZE) + 1))
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
    const label = event.currentTarget.dataset.label || labelOf(key)
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
            this._rows = this._rows.filter((row) => row.key !== key)
            this.setData(buildView(this._rows, Math.max(this.data.total - 1, this._rows.length),
              Math.floor(this._rows.length / PAGE_SIZE) + 1))
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

  onClearAll() {
    if (this.data.loaded === 0) return
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
            this.setData({ groups: [], loaded: 0, total: 0, hasMore: false })
            wx.showToast({ title: '已清空', icon: 'none' })
            return null
          })
          .catch(() => {
            wx.showToast({ title: '清空失败，请重试', icon: 'none' })
            return null
          })
      }
    })
  }
})

/** 后端行 → 页面内部行。id 保持字符串，避免大整数在 JS 里丢精度。 */
function toRow(record) {
  return {
    id: record.id,
    key: record.memoryKey,
    text: record.memoryText || '',
    timeText: formatTime(record.updatedAt)
  }
}

/**
 * 把扁平行组装成分组视图 + 分页状态。
 *
 * 保持后端给出的顺序（类名升序、类内按更新时间倒序），不在这里再排序：
 * 「为什么这一类排在前面」如果两边各排一次，翻页时就容易出现顺序抖动。
 */
function buildView(rows, total, pageNum) {
  const groups = []
  const index = new Map()
  rows.forEach((row) => {
    let group = index.get(row.key)
    if (!group) {
      group = { key: row.key, label: labelOf(row.key), count: 0, items: [] }
      index.set(row.key, group)
      groups.push(group)
    }
    group.items.push({ id: row.id, text: row.text, timeText: row.timeText })
    group.count += 1
  })
  const loaded = rows.length
  return {
    groups,
    loaded,
    total,
    // 用 total 判断还有没有下一页；后端 total 缺失时退化成"本页是否满一页"
    hasMore: total > loaded || loaded === pageNum * PAGE_SIZE
  }
}
