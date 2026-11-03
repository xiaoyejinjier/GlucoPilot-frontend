const { applyDisplayToCurrentPage } = require('../../utils/display')
const { fetchFoodCategories, fetchFoods } = require('../../services/api')

Page({
  data: {
    displayStyle: '',
    category: '',
    list: [],
    imageRevision: 0
  },

  onLoad(options) {
    const category = decodeURIComponent(options.category || '主食类')
    this.setData({ category })
    wx.setNavigationBarTitle({ title: category })
  },

  onShow() {
    applyDisplayToCurrentPage()
    return this.loadList(this.data.category)
  },

  onHide() { this._request = (this._request || 0) + 1 },
  onUnload() { this.onHide() },
  onPullDownRefresh() { return this.loadList(this.data.category).finally(() => wx.stopPullDownRefresh()) },

  loadList(category) {
    const request = this._request = (this._request || 0) + 1
    return fetchFoodCategories()
      .then((cats) => {
        if (request !== this._request) return null
        const meta = (cats || []).find((c) => c.categoryName === category)
        if (!meta) {
          this.setData({ list: [] })
          return null
        }
        return fetchFoods({ categoryId: meta.id, pageNum: 1, pageSize: 100 })
      })
      .then((page) => {
        if (!page || request !== this._request) return
        const records = (page.records || []).map((f) => ({ ...f, category }))
        this.setData({
          list: records,
          imageRevision: this.data.imageRevision + 1
        })
      })
      .catch(() => {
        if (request !== this._request) return
        this.setData({ list: [] })
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
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
  }
})
