const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')
const { fetchMe, updateSettings } = require('../../services/api')

const ITEM_META = [
  { key: 'glucose', title: '血糖提醒', desc: '到点提醒测量餐前/餐后血糖', field: 'notifyGlucose' },
  { key: 'meal', title: '饮食记录提醒', desc: '三餐时段提醒拍照记录', field: 'notifyMeal' },
  { key: 'news', title: '资讯推送', desc: '控糖科普与企业动态', field: 'notifyNews' }
]

Page({
  data: {
    displayStyle: '',
    themeBrand: '#0969da',
    items: ITEM_META.map((m) => ({ key: m.key, title: m.title, desc: m.desc, on: false }))
  },

  onLoad() {
    this.loadSettings()
  },

  onShow() {
    applyDisplayToCurrentPage()
    const brand = getTheme(getDisplaySettings().theme).brand
    this.setData({ themeBrand: brand })
  },

  loadSettings() {
    fetchMe()
      .then((me) => {
        this.setData({ items: this.toItems(me) })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '设置加载失败', icon: 'none' })
      })
  },

  toItems(me) {
    return ITEM_META.map((m) => ({
      key: m.key,
      title: m.title,
      desc: m.desc,
      on: !!me[m.field]
    }))
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key
    const on = e.detail.value
    const meta = ITEM_META.find((m) => m.key === key)
    if (!meta) return

    const previous = this.data.items
    this.setData({ items: previous.map((it) => (it.key === key ? { ...it, on } : it)) })

    updateSettings({ [meta.field]: on })
      .catch((err) => {
        // 落库失败就回滚开关，避免端上显示与实际设置不一致
        this.setData({ items: previous })
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
  }
})
