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
    /** 每项：{ key, label, text, timeText } */
    list: [],
    loading: false,
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

  load() {
    if (this.data.loading) return Promise.resolve(null)
    const version = (this._loadVersion = (this._loadVersion || 0) + 1)
    this.setData({ loading: true })
    return api
      .fetchAiMemories()
      .then((result) => {
        if (version !== this._loadVersion) return null
        const records = (result && result.records) || []
        this.setData({
          list: records.map((row) => ({
            key: row.memoryKey,
            label: labelOf(row.memoryKey),
            text: row.memoryText || '',
            timeText: formatTime(row.updatedAt)
          })),
          loading: false,
          error: ''
        })
        return null
      })
      .catch((err) => {
        if (version !== this._loadVersion) return null
        this.setData({ loading: false, error: (err && err.message) || '记忆加载失败' })
        return null
      })
  },

  onRetry() {
    this.setData({ error: '' })
    this.load()
  },

  /**
   * 删除单条。
   *
   * 传的是 memoryKey 而不是行内序号：后端单条删除的粒度就是键（每类只有一条生效记录），
   * 用键做参数在「列表刚刷新、下标对不上」时也不会误删别人的那条。
   */
  onDeleteTap(event) {
    const key = event.currentTarget.dataset.key
    if (!key) return
    wx.showModal({
      title: '删除这条记忆',
      content: '删除后小语不会再据此回答。',
      confirmText: '删除',
      success: (res) => {
        if (!res || !res.confirm) return
        this.removeOne(key)
      }
    })
  },

  removeOne(key) {
    return api
      .deleteAiMemory(key)
      .then(() => {
        // 乐观移除：后端返回 deleted=0（刚好被别人/别的端删掉）也应当从列表消失
        this.setData({ list: this.data.list.filter((item) => item.key !== key) })
        wx.showToast({ title: '已删除', icon: 'none' })
        return null
      })
      .catch(() => {
        wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        return null
      })
  },

  onClearAll() {
    if (this.data.list.length === 0) return
    wx.showModal({
      title: '清空全部记忆',
      content: '清空后小语会忘记之前记住的所有事，操作不可撤销。',
      confirmText: '清空',
      success: (res) => {
        if (!res || !res.confirm) return
        api
          .deleteAllAiMemories()
          .then(() => {
            this.setData({ list: [] })
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
