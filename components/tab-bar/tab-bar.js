const { getTheme, getDisplaySettings } = require('../../utils/display')

Component({
  properties: {
    selected: {
      type: Number,
      value: 0
    }
  },

  data: {
    brandColor: '#0969da'
  },

  lifetimes: {
    attached() {
      this.refreshBrand()
    }
  },

  pageLifetimes: {
    show() {
      this.refreshBrand()
    }
  },

  methods: {
    refreshBrand() {
      const brand = getTheme(getDisplaySettings().theme).brand
      this.setData({ brandColor: brand })
    }
  }
})
