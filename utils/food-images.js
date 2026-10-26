/**
 * 小程序内置食物图片映射。
 *
 * 管理端内置图片地址只在管理站点中可用，因此小程序收到这类地址时，
 * 会按食物名称或文件名映射到 frontend/assets/foods 中随源码发布的图片。
 */
const { baseUrl } = require('./config')

const FOOD_IMAGE_BY_NAME = {
  米饭: '/assets/foods/rice.svg',
  燕麦: '/assets/foods/oat.svg',
  面条: '/assets/foods/noodle.svg',
  馒头: '/assets/foods/steamed-bun.svg',
  鸡胸肉: '/assets/foods/chicken.svg',
  鸡蛋: '/assets/foods/egg.svg',
  瘦猪肉: '/assets/foods/pork.svg',
  西兰花: '/assets/foods/broccoli.svg',
  黄瓜: '/assets/foods/cucumber.svg',
  西红柿: '/assets/foods/tomato.svg',
  苹果: '/assets/foods/apple.svg',
  香蕉: '/assets/foods/banana.svg',
  牛奶: '/assets/foods/milk.svg',
  酸奶: '/assets/foods/yogurt.svg',
  豆腐: '/assets/foods/tofu.svg',
  豆浆: '/assets/foods/soy-milk.svg',
  杏仁: '/assets/foods/almond.svg',
  核桃: '/assets/foods/walnut.svg',
  矿泉水: '/assets/foods/water.svg',
  无糖豆浆: '/assets/foods/sugar-free-soy-milk.svg',
  苏打饼干: '/assets/foods/cracker.svg'
}

const ADMIN_FILE_TO_MINI_IMAGE = {
  rice: '/assets/foods/rice.svg',
  oat: '/assets/foods/oat.svg',
  noodle: '/assets/foods/noodle.svg',
  'steamed-bun': '/assets/foods/steamed-bun.svg',
  chicken: '/assets/foods/chicken.svg',
  egg: '/assets/foods/egg.svg',
  pork: '/assets/foods/pork.svg',
  broccoli: '/assets/foods/broccoli.svg',
  cucumber: '/assets/foods/cucumber.svg',
  tomato: '/assets/foods/tomato.svg',
  apple: '/assets/foods/apple.svg',
  banana: '/assets/foods/banana.svg',
  milk: '/assets/foods/milk.svg',
  yogurt: '/assets/foods/yogurt.svg',
  tofu: '/assets/foods/tofu.svg',
  'soy-milk': '/assets/foods/soy-milk.svg',
  almond: '/assets/foods/almond.svg',
  walnut: '/assets/foods/walnut.svg',
  water: '/assets/foods/water.svg',
  'sugar-free-soy-milk': '/assets/foods/sugar-free-soy-milk.svg',
  cracker: '/assets/foods/cracker.svg'
}

const FOOD_IMAGE_BY_CATEGORY = {
  主食类: '/assets/foods/rice.svg',
  肉蛋类: '/assets/foods/chicken.svg',
  蔬菜类: '/assets/foods/broccoli.svg',
  水果类: '/assets/foods/apple.svg',
  奶类: '/assets/foods/milk.svg',
  豆制品: '/assets/foods/tofu.svg',
  坚果类: '/assets/foods/almond.svg',
  饮料类: '/assets/foods/water.svg',
  零食及其他: '/assets/foods/cracker.svg'
}

const DEFAULT_FOOD_IMAGE = '/assets/foods/rice.svg'

function getFoodImage(name, categoryName, imageUrl) {
  const source = String(imageUrl || '').trim()

  // 完整公网地址由小程序直接展示；生产环境需在微信后台配置下载域名。
  if (/^https?:\/\//i.test(source)) return source

  // 后台上传的配图使用稳定 API 路径，通过用户端统一配置解析。
  if (/^\/api\/v1\/foods\/images\/\d+$/.test(source)) {
    return `${baseUrl.replace(/\/+$/, '')}${source.slice('/api/v1'.length)}`
  }

  // 小程序自身的本地资源可以直接使用。
  if (source.startsWith('/assets/foods/') && source.toLowerCase().endsWith('.svg')) return source

  // 把管理端 /images/foods/*.svg 地址转换成小程序本地图片。
  const fileMatch = source.match(/\/images\/foods\/([^/.]+)\.(?:svg|png|jpe?g)$/i)
  if (fileMatch && ADMIN_FILE_TO_MINI_IMAGE[fileMatch[1]]) {
    return ADMIN_FILE_TO_MINI_IMAGE[fileMatch[1]]
  }

  // 兼容管理端旧内置地址，分类选择了其他内置图时仍展示同款。
  const legacyMatch = source.match(/^\/img\/food-([^/.]+)\.svg$/i)
  if (legacyMatch) {
    const name = legacyMatch[1] === 'bun' ? 'steamed-bun' : legacyMatch[1]
    if (ADMIN_FILE_TO_MINI_IMAGE[name]) return ADMIN_FILE_TO_MINI_IMAGE[name]
  }

  return FOOD_IMAGE_BY_NAME[String(name || '').trim()] ||
    FOOD_IMAGE_BY_CATEGORY[categoryName || ''] ||
    DEFAULT_FOOD_IMAGE
}

module.exports = {
  DEFAULT_FOOD_IMAGE,
  getFoodImage
}
