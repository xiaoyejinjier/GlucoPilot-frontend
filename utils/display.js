/** 界面展示：字号 / 主题色（全局生效） */

const FONT_MAP = {
  标准: {
    key: 'std',
    fs: '28rpx',
    hero: '52rpx',
    title: '34rpx',
    body: '28rpx',
    small: '22rpx',
    tiny: '20rpx',
    metric: '36rpx'
  },
  较大: {
    key: 'lg',
    fs: '30rpx',
    hero: '56rpx',
    title: '38rpx',
    body: '30rpx',
    small: '24rpx',
    tiny: '22rpx',
    metric: '40rpx'
  },
  更大: {
    key: 'xl',
    fs: '34rpx',
    hero: '64rpx',
    title: '44rpx',
    body: '34rpx',
    small: '26rpx',
    tiny: '24rpx',
    metric: '46rpx'
  }
}

const THEME_MAP = {
  green: {
    id: 'green',
    label: '经典蓝',
    brand: '#2770cf',
    brandDark: '#194f91',
    brandSoft: '#e8f1fd',
    brandLine: '#cadcf2',
    wxGreen: '#e8f1fd',
    navBg: '#ffffff',
    navFront: '#000000',
    tabSelected: '#2770cf'
  },
  teal: {
    id: 'teal',
    label: '静谧蓝',
    brand: '#316d9b',
    brandDark: '#24547c',
    brandSoft: '#edf4fa',
    brandLine: '#c9dbea',
    wxGreen: '#e0edf8',
    navBg: '#ffffff',
    navFront: '#000000',
    tabSelected: '#316d9b'
  },
  simple: {
    id: 'simple',
    label: '简洁白',
    brand: '#374151',
    brandDark: '#1f2937',
    brandSoft: '#f3f4f6',
    brandLine: '#d9dfe5',
    wxGreen: '#e8ebef',
    navBg: '#ffffff',
    navFront: '#000000',
    tabSelected: '#374151'
  }
}

function getDisplaySettings() {
  const saved = wx.getStorageSync('displaySettings') || {}
  const fontSize = FONT_MAP[saved.fontSize] ? saved.fontSize : '较大'
  const theme = THEME_MAP[saved.theme] ? saved.theme : 'green'
  return { fontSize, theme }
}

function saveDisplaySettings(partial) {
  const cur = getDisplaySettings()
  const next = {
    fontSize: partial.fontSize || cur.fontSize,
    theme: partial.theme || cur.theme
  }
  wx.setStorageSync('displaySettings', next)
  return next
}

function getTheme(themeId) {
  return THEME_MAP[themeId] || THEME_MAP.green
}

function getFont(fontSize) {
  return FONT_MAP[fontSize] || FONT_MAP['较大']
}

/** 挂到页面根节点的 style（CSS 变量会向下继承） */
function getDisplayStyle(settings) {
  const s = settings || getDisplaySettings()
  const t = getTheme(s.theme)
  const f = getFont(s.fontSize)
  return [
    `--brand:${t.brand}`,
    `--brand-dark:${t.brandDark}`,
    `--brand-soft:${t.brandSoft}`,
    `--brand-line:${t.brandLine}`,
    `--wx-green:${t.wxGreen}`,
    `--ok:${t.brand}`,
    `--fs:${f.fs}`,
    `--fs-hero:${f.hero}`,
    `--fs-title:${f.title}`,
    `--fs-body:${f.body}`,
    `--fs-small:${f.small}`,
    `--fs-tiny:${f.tiny}`,
    `--fs-metric:${f.metric}`,
    `font-size:${f.fs}`
  ].join(';')
}

function applyNavigationBar(settings) {
  const s = settings || getDisplaySettings()
  const t = getTheme(s.theme)
  try {
    wx.setNavigationBarColor({
      frontColor: t.navFront,
      backgroundColor: t.navBg,
      animation: { duration: 0, timingFunc: 'easeIn' }
    })
  } catch (e) { /* ignore */ }
}

/** 同步到当前页 + TabBar 选中色 */
function applyDisplayToCurrentPage() {
  const settings = getDisplaySettings()
  const style = getDisplayStyle(settings)
  const theme = getTheme(settings.theme)
  applyNavigationBar(settings)

  const pages = getCurrentPages()
  const cur = pages[pages.length - 1]
  if (cur && typeof cur.setData === 'function') {
    cur.setData({
      displayStyle: style,
      themeBrand: theme.brand
    })
    if (typeof cur.getTabBar === 'function' && cur.getTabBar()) {
      cur.getTabBar().setData({ selectedColor: theme.tabSelected })
    }
  }
  return { settings, style, theme }
}

module.exports = {
  FONT_MAP,
  THEME_MAP,
  getDisplaySettings,
  saveDisplaySettings,
  getTheme,
  getFont,
  getDisplayStyle,
  applyNavigationBar,
  applyDisplayToCurrentPage
}
