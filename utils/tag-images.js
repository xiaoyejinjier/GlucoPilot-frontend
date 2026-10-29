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

function resolve(tag) {
  if (!tag) return DEFAULT
  const code = String(tag.code || '').trim()
  if (code && ICONS[code]) return ICONS[code]
  if (tag.type === 'USER' || tag.deletable || code.startsWith('custom_')) return CUSTOM
  return DEFAULT
}

module.exports = { resolve, ICONS, CUSTOM, DEFAULT }
