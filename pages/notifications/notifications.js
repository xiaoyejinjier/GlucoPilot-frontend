const { applyDisplayToCurrentPage, getTheme, getDisplaySettings } = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    themeBrand: '#07c160',
    items: [
      { key: 'glucose', title: '血糖提醒', desc: '到点提醒测量餐前/餐后血糖', on: true },
      { key: 'meal', title: '饮食记录提醒', desc: '三餐时段提醒拍照记录', on: true },
      { key: 'news', title: '资讯推送', desc: '控糖科普与企业动态', on: false }
    ]
  },

  onLoad() {
    const saved = wx.getStorageSync('notifySettings')
    if (saved && saved.length) this.setData({ items: saved })
  },

  onShow() {
    applyDisplayToCurrentPage()
    const brand = getTheme(getDisplaySettings().theme).brand
    this.setData({ themeBrand: brand })
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key
    const on = e.detail.value
    const items = this.data.items.map(it => it.key === key ? { ...it, on } : it)
    this.setData({ items })
    wx.setStorageSync('notifySettings', items)
  }
})
