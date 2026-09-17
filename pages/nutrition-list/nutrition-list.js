const { getFoodsByCategory } = require('../../utils/food-db')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods } = require('../../services/api')

Page({
  data: {
    displayStyle: '',
    category: '',
    list: []
  },

  onLoad(options) {
    const category = decodeURIComponent(options.category || '主食类')
    this.setData({ category })
    wx.setNavigationBarTitle({ title: category })
    this.loadList(category)
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  loadList(category) {
    fetchFoodCategories()
      .then((cats) => {
        const idx = (cats || []).findIndex((c) => c.categoryName === category)
        const code = idx >= 0 ? idx + 1 : null
        if (!code) {
          this.setData({ list: getFoodsByCategory(category) })
          return null
        }
        return fetchFoods({ categoryCode: code, pageNum: 1, pageSize: 100 })
      })
      .then((page) => {
        if (!page) return
        const records = ((page.records) || []).map((f) => ({ ...f, category }))
        this.setData({
          list: records.length ? records : getFoodsByCategory(category)
        })
      })
      .catch(() => {
        this.setData({ list: getFoodsByCategory(category) })
      })
  },

  onFoodTap(e) {
    const name = e.currentTarget.dataset.name
    const item = this.data.list.find((f) => f.name === name)
    if (!item) return
    wx.showModal({
      title: item.name,
      content: `${item.carbs}克碳水/100g · 热量 ${item.cal}kcal`,
      showCancel: false
    })
  }
})
