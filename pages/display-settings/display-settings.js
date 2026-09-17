const {
  getDisplaySettings,
  saveDisplaySettings,
  getDisplayStyle,
  applyNavigationBar,
  getTheme,
  THEME_MAP
} = require('../../utils/display')

Page({
  data: {
    displayStyle: '',
    fontSizes: ['标准', '较大', '更大'],
    fontSize: '较大',
    themes: [
      { id: 'green', label: '品牌绿' },
      { id: 'teal', label: '青绿' },
      { id: 'simple', label: '简洁白' }
    ],
    theme: 'green',
    themeLabel: '品牌绿'
  },

  onLoad() {
    this.loadAndApply()
  },

  onShow() {
    this.loadAndApply()
  },

  loadAndApply() {
    const saved = getDisplaySettings()
    const t = getTheme(saved.theme)
    this.setData({
      fontSize: saved.fontSize,
      theme: saved.theme,
      themeLabel: t.label,
      displayStyle: getDisplayStyle(saved)
    })
    applyNavigationBar(saved)
  },

  applyNow() {
    const settings = saveDisplaySettings({
      fontSize: this.data.fontSize,
      theme: this.data.theme
    })
    const t = getTheme(settings.theme)
    this.setData({
      themeLabel: t.label,
      displayStyle: getDisplayStyle(settings)
    })
    applyNavigationBar(settings)
    wx.showToast({ title: '已应用', icon: 'success' })
  },

  onFont(e) {
    this.setData({ fontSize: e.currentTarget.dataset.val })
    this.applyNow()
  },

  onTheme(e) {
    const id = e.currentTarget.dataset.val
    const t = THEME_MAP[id] || THEME_MAP.green
    this.setData({ theme: id, themeLabel: t.label })
    this.applyNow()
  }
})
