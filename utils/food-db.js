/** 营养库演示数据（含本地小图） */
const FOOD_DB = [
  { name: '米饭', category: '主食类', carbs: 25.9, cal: 116, image: '/assets/foods/rice.jpg' },
  { name: '燕麦', category: '主食类', carbs: 66.3, cal: 367, image: '/assets/foods/oat.jpg' },
  { name: '面条', category: '主食类', carbs: 55.0, cal: 284, image: '/assets/foods/noodle.jpg' },
  { name: '馒头', category: '主食类', carbs: 47.0, cal: 221, image: '/assets/foods/bun.jpg' },
  { name: '鸡胸肉', category: '肉蛋类', carbs: 0, cal: 133, image: '/assets/foods/chicken.jpg' },
  { name: '鸡蛋', category: '肉蛋类', carbs: 1.1, cal: 144, image: '/assets/foods/egg.jpg' },
  { name: '瘦猪肉', category: '肉蛋类', carbs: 0, cal: 143, image: '/assets/foods/pork.jpg' },
  { name: '西兰花', category: '蔬菜类', carbs: 4.3, cal: 34, image: '/assets/foods/broccoli.jpg' },
  { name: '黄瓜', category: '蔬菜类', carbs: 2.4, cal: 16, image: '/assets/foods/cucumber.jpg' },
  { name: '西红柿', category: '蔬菜类', carbs: 3.3, cal: 19, image: '/assets/foods/tomato.jpg' },
  { name: '苹果', category: '水果类', carbs: 13.7, cal: 52, image: '/assets/foods/apple.jpg' },
  { name: '香蕉', category: '水果类', carbs: 22.8, cal: 89, image: '/assets/foods/banana.jpg' },
  { name: '牛奶', category: '奶类', carbs: 4.8, cal: 54, image: '/assets/foods/yogurt.jpg' },
  { name: '酸奶', category: '奶类', carbs: 9.5, cal: 72, image: '/assets/foods/yogurt.jpg' },
  { name: '豆腐', category: '豆制品', carbs: 2.6, cal: 81, image: '/assets/foods/tofu.jpg' },
  { name: '豆浆', category: '豆制品', carbs: 1.1, cal: 14, image: '/assets/foods/soy.jpg' },
  { name: '杏仁', category: '坚果类', carbs: 9.5, cal: 578, image: '/assets/foods/almond.jpg' },
  { name: '核桃', category: '坚果类', carbs: 9.6, cal: 646, image: '/assets/foods/walnut.jpg' },
  { name: '矿泉水', category: '饮料类', carbs: 0, cal: 0, image: '/assets/foods/water.jpg' },
  { name: '无糖豆浆', category: '饮料类', carbs: 1.1, cal: 14, image: '/assets/foods/soy.jpg' },
  { name: '苏打饼干', category: '零食及其他', carbs: 70.0, cal: 433, image: '/assets/foods/biscuit.jpg' }
]

function getFoodsByCategory(category) {
  return FOOD_DB.filter(f => f.category === category)
}

function searchFoods(keyword) {
  const k = (keyword || '').trim()
  if (!k) return []
  return FOOD_DB.filter(f => f.name.includes(k) || f.category.includes(k))
}

module.exports = {
  FOOD_DB,
  getFoodsByCategory,
  searchFoods
}
