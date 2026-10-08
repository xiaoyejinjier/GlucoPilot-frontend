const { getFoodImage } = require('./food-images')

/** 营养库演示数据（含本地小图） */
const FOOD_DB = [
  { name: '米饭', category: '主食类', carbs: 25.9, cal: 116 },
  { name: '燕麦', category: '主食类', carbs: 66.3, cal: 367 },
  { name: '面条', category: '主食类', carbs: 55.0, cal: 284 },
  { name: '馒头', category: '主食类', carbs: 47.0, cal: 221 },
  { name: '鸡胸肉', category: '肉蛋类', carbs: 0, cal: 133 },
  { name: '鸡蛋', category: '肉蛋类', carbs: 1.1, cal: 144 },
  { name: '瘦猪肉', category: '肉蛋类', carbs: 0, cal: 143 },
  { name: '西兰花', category: '蔬菜类', carbs: 4.3, cal: 34 },
  { name: '黄瓜', category: '蔬菜类', carbs: 2.4, cal: 16 },
  { name: '西红柿', category: '蔬菜类', carbs: 3.3, cal: 19 },
  { name: '苹果', category: '水果类', carbs: 13.7, cal: 52 },
  { name: '香蕉', category: '水果类', carbs: 22.8, cal: 89 },
  { name: '牛奶', category: '奶类', carbs: 4.8, cal: 54 },
  { name: '酸奶', category: '奶类', carbs: 9.5, cal: 72 },
  { name: '豆腐', category: '豆制品', carbs: 2.6, cal: 81 },
  { name: '豆浆', category: '豆制品', carbs: 1.1, cal: 14 },
  { name: '杏仁', category: '坚果类', carbs: 9.5, cal: 578 },
  { name: '核桃', category: '坚果类', carbs: 9.6, cal: 646 },
  { name: '矿泉水', category: '饮料类', carbs: 0, cal: 0 },
  { name: '无糖豆浆', category: '饮料类', carbs: 1.1, cal: 14 },
  { name: '苏打饼干', category: '零食及其他', carbs: 70.0, cal: 433 }
].map((food) => ({
  ...food,
  image: getFoodImage(food.name, food.category)
}))

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
