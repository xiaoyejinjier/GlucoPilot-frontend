const { FOOD_CATEGORIES } = require('../../utils/constants')
const { searchFoods, getFoodsByCategory } = require('../../utils/food-db')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods } = require('../../services/api')
const config = require('../../utils/config')

Page({
  data: {
    displayStyle: '',
    categories: FOOD_CATEGORIES,
    categoryMeta: [],
    keyword: '',
    searchResults: [],
    usingRemote: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.loadCategories()
  },

  loadCategories() {
    fetchFoodCategories()
      .then((list) => {
        if (!list || !list.length) return
        this.setData({
          usingRemote: true,
          categoryMeta: list,
          categories: list.map((c) => c.categoryName)
        })
      })
      .catch(() => {
        if (!config.fallbackLocal) {
          this.setData({ categories: [], categoryMeta: [] })
        }
      })
  },

  onSearch(e) {
    const keyword = e.detail.value.trim()
    this.setData({ keyword })
    if (!keyword) {
      this.setData({ searchResults: [] })
      return
    }

    fetchFoods({ keyword, pageNum: 1, pageSize: 50 })
      .then((page) => {
        const records = (page && page.records) || []
        if (records.length || this.data.usingRemote) {
          this.setData({ searchResults: records })
        } else {
          this.setData({ searchResults: searchFoods(keyword) })
        }
      })
      .catch(() => {
        this.setData({ searchResults: searchFoods(keyword) })
      })
  },

  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.cat
    const meta = (this.data.categoryMeta || []).find((c) => c.categoryName === cat)
    this.setData({ keyword: cat })

    if (meta && meta.id) {
      // 按大类枚举码筛：与种子 category_code / 分类顺序对齐
      const code = this.data.categoryMeta.findIndex((c) => c.categoryName === cat) + 1
      fetchFoods({ categoryCode: code > 0 ? code : undefined, pageNum: 1, pageSize: 50 })
        .then((page) => {
          const records = ((page && page.records) || []).map((f) => ({ ...f, category: cat }))
          this.setData({
            searchResults: records.length ? records : getFoodsByCategory(cat)
          })
        })
        .catch(() => {
          this.setData({ searchResults: getFoodsByCategory(cat) })
        })
      return
    }

    this.setData({ searchResults: getFoodsByCategory(cat) })
  },

  onFoodTap(e) {
    const name = e.currentTarget.dataset.name
    const food = this.data.searchResults.find((f) => f.name === name)
    if (!food) return
    wx.showModal({
      title: food.name,
      content: `${food.carbs}克碳水/100g · 热量 ${food.cal}kcal`,
      showCancel: false
    })
  }
})
