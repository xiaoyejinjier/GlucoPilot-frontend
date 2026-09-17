/** 页面混入：同步字号 / 主题色 */
const { getDisplayStyle, applyNavigationBar, getDisplaySettings, getTheme } = require('../utils/display')

module.exports = Behavior({
  data: {
    displayStyle: ''
  },

  lifetimes: {
    attached() {
      this.syncDisplay()
    }
  },

  pageLifetimes: {
    show() {
      this.syncDisplay()
    }
  },

  methods: {
    syncDisplay() {
      const settings = getDisplaySettings()
      const style = getDisplayStyle(settings)
      const theme = getTheme(settings.theme)
      if (this.data.displayStyle !== style) {
        this.setData({ displayStyle: style })
      }
      applyNavigationBar(settings)
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ selectedColor: theme.tabSelected })
      }
    }
  }
})
