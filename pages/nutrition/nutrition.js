const { FOOD_CATEGORIES } = require('../../utils/constants')
const { searchFoods, getFoodsByCategory } = require('../../utils/food-db')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods, fetchFoodDetail } = require('../../services/api')
const config = require('../../utils/config')
const { DEFAULT_FOOD_IMAGE, getFoodImage } = require('../../utils/food-images')

function categoryItem(category) {
  const name = typeof category === 'string' ? category : category.categoryName
  return { id: String(category.id || name), name, icon: getFoodImage('', name, category.imageUrl) }
}

Page({
  data: {
    displayStyle: '',
    categories: FOOD_CATEGORIES.map(categoryItem),
    categoryMeta: [],
    keyword: '',
    searchResults: [],
    usingRemote: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.loadCategories()
  },

  onHide() { this._categoryRequest = (this._categoryRequest || 0) + 1 },
  onUnload() { this._categoryRequest = (this._categoryRequest || 0) + 1 },

  onPullDownRefresh() {
    return this.loadCategories().finally(() => wx.stopPullDownRefresh())
  },

  loadCategories() {
    const request = this._categoryRequest = (this._categoryRequest || 0) + 1
    return fetchFoodCategories()
      .then((list) => {
        if (request !== this._categoryRequest) return
        const rows = list || []
        this.setData({
          usingRemote: true,
          categoryMeta: rows,
          categories: rows.map(categoryItem)
        })
      })
      .catch(() => {
        if (request !== this._categoryRequest) return
        if (!config.fallbackLocal) {
          this.setData({ categories: [], categoryMeta: [], usingRemote: false })
        }
      })
  },

  onCategoryImageError(e) {
    const { id, src } = e.currentTarget.dataset
    const index = this.data.categories.findIndex(item => item.id === String(id))
    const category = this.data.categories[index]
    if (!category || category.icon !== src) return
    const fallback = getFoodImage('', category.name)
    if (category.icon !== fallback) this.setData({ [`categories[${index}].icon`]: fallback })
  },

  onSearch(e) {
    const keyword = e.detail.value.trim()
    this.setData({ keyword })
    if (!keyword) {
      this.setData({ searchResults: [] })
      return
    }
    this.query({ keyword })
  },

  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.cat
    const meta = (this.data.categoryMeta || []).find((c) => c.categoryName === cat)
    this.setData({ keyword: cat })
    // 优先按分类主键过滤，未拉到分类时退回本地演示数据
    this.query(meta && meta.id ? { categoryId: meta.id } : null, cat)
  },

  query(params, fallbackCategory) {
    if (!params) {
      this.setData({ searchResults: getFoodsByCategory(fallbackCategory) })
      return
    }
    fetchFoods({ ...params, pageNum: 1, pageSize: 100 })
      .then((page) => {
        const records = (page && page.records) || []
        this.setData({
          searchResults: records.length ? records : getFoodsByCategory(fallbackCategory)
        })
      })
      .catch(() => {
        this.setData({
          searchResults: fallbackCategory
            ? getFoodsByCategory(fallbackCategory)
            : searchFoods(this.data.keyword)
        })
      })
  },

  onFoodTap(e) {
    const food = this.data.searchResults[Number(e.currentTarget.dataset.index)]
    if (!food) return

    const show = (item) => wx.showModal({
      title: item.name,
      content: [
        `${item.carbs}克碳水/100g`,
        `热量 ${item.cal}kcal`,
        item.gi != null ? `GI ${item.gi}` : 'GI 暂无数据'
      ].join(' · '),
      showCancel: false
    })

    // 本地降级数据没有后端 id，直接展示已有字段
    if (!food.id) {
      show(food)
      return
    }
    fetchFoodDetail(food.id)
      .then(show)
      .catch((err) => wx.showToast({ title: err.message || '详情加载失败', icon: 'none' }))
  },

  onImageError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.searchResults[index]) return
    this.setData({ [`searchResults[${index}].image`]: DEFAULT_FOOD_IMAGE })
  }
})
