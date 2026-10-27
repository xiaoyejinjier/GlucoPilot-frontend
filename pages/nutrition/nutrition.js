const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods, fetchFoodDetail } = require('../../services/api')
const { DEFAULT_FOOD_IMAGE, getFoodImage } = require('../../utils/food-images')

function categoryItem(category) {
  const name = typeof category === 'string' ? category : category.categoryName
  return { id: String(category.id || name), name, icon: getFoodImage('', name, category.imageUrl) }
}

Page({
  data: {
    displayStyle: '',
    categories: [],
    categoryMeta: [],
    keyword: '',
    searchResults: [],
    usingRemote: false
  },

  onShow() {
    applyDisplayToCurrentPage()
    this.loadCategories()
  },

  onHide() {
    this._categoryRequest = (this._categoryRequest || 0) + 1
    this._foodRequest = (this._foodRequest || 0) + 1
  },
  onUnload() { this.onHide() },

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
        if (this.data.keyword) return this.reloadFoods()
      })
      .catch(() => {
        if (request !== this._categoryRequest) return
        this.setData({ usingRemote: false })
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
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
    this._selectedCategory = ''
    this._foodRequest = (this._foodRequest || 0) + 1
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
    this._selectedCategory = cat
    this.setData({ keyword: cat })
    this.query(meta && meta.id ? { categoryId: meta.id } : null)
  },

  reloadFoods() {
    if (!this._selectedCategory) return this.query({ keyword: this.data.keyword })
    const category = (this.data.categoryMeta || []).find(c => c.categoryName === this._selectedCategory)
    return this.query(category ? { categoryId: category.id } : null)
  },

  query(params) {
    const request = this._foodRequest = (this._foodRequest || 0) + 1
    if (!params) {
      this.setData({ searchResults: [] })
      return Promise.resolve()
    }
    return fetchFoods({ ...params, pageNum: 1, pageSize: 100 })
      .then((page) => {
        if (request !== this._foodRequest) return
        const records = (page && page.records) || []
        this.setData({ searchResults: records })
      })
      .catch(() => {
        if (request !== this._foodRequest) return
        this.setData({ searchResults: [] })
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
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
    const item = this.data.searchResults[index]
    if (!Number.isInteger(index) || !item || item.image !== e.currentTarget.dataset.src) return
    if (item.image === DEFAULT_FOOD_IMAGE) return
    this.setData({ [`searchResults[${index}].image`]: DEFAULT_FOOD_IMAGE })
  }
})
