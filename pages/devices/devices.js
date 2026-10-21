const { applyDisplayToCurrentPage } = require('../../utils/display')

Page({
  data: { displayStyle: '' },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 1 })
      if (typeof tabBar.refreshGuide === 'function') tabBar.refreshGuide()
    }
    applyDisplayToCurrentPage()
  }
})
