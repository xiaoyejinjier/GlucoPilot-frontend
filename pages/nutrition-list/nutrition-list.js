const { getFoodsByCategory } = require('../../utils/food-db')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods } = require('../../services/api')
const { DEFAULT_FOOD_IMAGE } = require('../../utils/food-images')

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
        const meta = (cats || []).find((c) => c.categoryName === category)
        if (!meta) {
          this.setData({ list: getFoodsByCategory(category) })
          return null
        }
        return fetchFoods({ categoryId: meta.id, pageNum: 1, pageSize: 100 })
      })
      .then((page) => {
        if (!page) return
        const records = (page.records || []).map((f) => ({ ...f, category }))
        this.setData({
          list: records.length ? records : getFoodsByCategory(category)
        })
      })
      .catch(() => {
        this.setData({ list: getFoodsByCategory(category) })
      })
  },

  onFoodTap(e) {
    const item = this.data.list[Number(e.currentTarget.dataset.index)]
    if (!item) return
    wx.showModal({
      title: item.name,
      content: `${item.carbs}克碳水/100g · 热量 ${item.cal}kcal` +
        (item.gi != null ? ` · GI ${item.gi}` : ''),
      showCancel: false
    })
  },

  onImageError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.list[index]) return
    this.setData({ [`list[${index}].image`]: DEFAULT_FOOD_IMAGE })
  }
})
