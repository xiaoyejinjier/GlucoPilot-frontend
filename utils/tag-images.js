/** 社区标签图标：按 code 映射，未知官方/自建用默认图。 */
const ICONS = {
  diet: '/assets/tags/diet.svg',
  type1: '/assets/tags/type1.svg',
  type2: '/assets/tags/type2.svg',
  medication: '/assets/tags/medication.svg',
  exercise: '/assets/tags/exercise.svg',
  daily: '/assets/tags/daily.svg',
  other: '/assets/tags/other.svg'
}
const CUSTOM = '/assets/tags/custom.svg'
const DEFAULT = '/assets/tags/default.svg'

// 求助广场沿用社区标签的圆角彩色图标；未配置的新分类回退到通用健康图标。
const TOPIC_ICONS = {
  GLUCOSE: '/assets/consultation-topics/glucose.svg',
  FASTING: '/assets/consultation-topics/fasting.svg',
  POST_MEAL: '/assets/consultation-topics/meal.svg',
  HYPOGLYCEMIA: '/assets/consultation-topics/low-glucose.svg',
  HYPERGLYCEMIA: '/assets/consultation-topics/high-glucose.svg',
  NIGHT_GLUCOSE: '/assets/consultation-topics/night.svg',
  DAWN: '/assets/consultation-topics/dawn.svg',
  GLUCOSE_TREND: '/assets/consultation-topics/trend.svg',
  GLUCOSE_TARGET: '/assets/consultation-topics/target.svg',
  GLUCOSE_TEST: '/assets/consultation-topics/meter.svg',
  CGM: '/assets/consultation-topics/cgm.svg',
  DEVICE: '/assets/consultation-topics/meter.svg',
  DIET: ICONS.diet,
  FOOD_CHOICES: ICONS.diet,
  CARBS: '/assets/consultation-topics/carbs.svg',
  GI: '/assets/consultation-topics/gi.svg',
  MEAL_PORTIONS: '/assets/consultation-topics/portions.svg',
  EATING_OUT: '/assets/consultation-topics/eating-out.svg',
  MEDICATION: ICONS.medication,
  INSULIN: '/assets/consultation-topics/insulin.svg',
  MEDICATION_TIME: '/assets/consultation-topics/medicine-time.svg',
  CHECKUP: '/assets/consultation-topics/checkup.svg',
  HBA1C: '/assets/consultation-topics/hba1c.svg',
  FOLLOW_UP: ICONS.daily,
  COMPLICATIONS: '/assets/consultation-topics/shield.svg',
  EXERCISE: ICONS.exercise,
  WEIGHT: '/assets/consultation-topics/weight.svg',
  SLEEP: '/assets/consultation-topics/sleep.svg',
  STRESS: '/assets/consultation-topics/stress.svg',
  SICK_DAY: '/assets/consultation-topics/sick-day.svg'
}

function resolveTopic(topic) { return TOPIC_ICONS[topic && topic.code] || DEFAULT }

function resolve(tag) {
  if (!tag) return DEFAULT
  const code = String(tag.code || '').trim()
  if (code && ICONS[code]) return ICONS[code]
  if (tag.type === 'USER' || tag.deletable || code.startsWith('custom_')) return CUSTOM
  return DEFAULT
}

module.exports = { resolve, resolveTopic, ICONS, TOPIC_ICONS, CUSTOM, DEFAULT }
