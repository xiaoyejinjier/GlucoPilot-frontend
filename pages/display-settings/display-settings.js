const {
  getDisplaySettings,
  saveDisplaySettings,
  getDisplayStyle,
  applyNavigationBar,
  getTheme,
  THEME_MAP
} = require('../../utils/display')
const { fetchMe, updateSettings } = require('../../services/api')
const { fontNameOf, fontCodeOf, themeIdOf, themeCodeOf } = require('../../utils/mappers')

Page({
  data: {
    displayStyle: '',
    fontSizes: ['标准', '较大', '更大'],
    fontSize: '较大',
    themes: [
      { id: 'green', label: '经典蓝' },
      { id: 'teal', label: '静谧蓝' },
      { id: 'simple', label: '简洁白' }
    ],
    theme: 'green',
    themeLabel: '经典蓝'
  },

  onLoad() {
    this.loadAndApply()
    // 服务端是偏好设置的唯一数据源，拉取后覆盖本地并重新应用
    fetchMe()
      .then((me) => {
        saveDisplaySettings({ fontSize: fontNameOf(me.fontSize), theme: themeIdOf(me.themeCode) })
        this.loadAndApply()
      })
      .catch(() => null)
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

  /** 主题/字号本地立即生效，同时落库；落库失败不打断本地体验。 */
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

    updateSettings({
      fontSize: fontCodeOf(settings.fontSize),
      themeCode: themeCodeOf(settings.theme)
    })
      .then(() => wx.showToast({ title: '已应用', icon: 'success' }))
      .catch((err) => wx.showToast({ title: err.message || '已本地生效，同步失败', icon: 'none' }))
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
