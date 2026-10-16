Component({
  data: {
    selected: 0,
    selectedColor: '#07c160'
  },

  methods: {
    onTabChange(e) {
      this.setData({ selected: e.detail.index })
    }
  }
})
