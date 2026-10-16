const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '' },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    applyDisplayToCurrentPage()
  }
})
