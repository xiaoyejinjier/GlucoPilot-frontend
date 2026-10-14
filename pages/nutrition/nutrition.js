const { FOOD_CATEGORIES } = require('../../utils/constants')
const { searchFoods, getFoodsByCategory } = require('../../utils/food-db')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods, fetchFoodDetail } = require('../../services/api')
const config = require('../../utils/config')
const { DEFAULT_FOOD_IMAGE } = require('../../utils/food-images')

const CATEGORY_ICONS = {
  '主食类': '/assets/foods/rice.svg',
  '肉蛋类': '/assets/foods/chicken.svg',
  '蔬菜类': '/assets/foods/broccoli.svg',
  '水果类': '/assets/foods/apple.svg',
  '奶类': '/assets/foods/milk.svg',
  '豆制品': '/assets/foods/tofu.svg',
  '坚果类': '/assets/foods/walnut.svg',
  '饮料类': '/assets/foods/water.svg',
  '零食及其他': '/assets/foods/cracker.svg'
}

function categoryItem(name) {
  return { name, icon: CATEGORY_ICONS[name] || DEFAULT_FOOD_IMAGE }
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

  loadCategories() {
    fetchFoodCategories()
      .then((list) => {
        if (!list || !list.length) return
        this.setData({
          usingRemote: true,
          categoryMeta: list,
          categories: list.map((c) => categoryItem(c.categoryName))
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
