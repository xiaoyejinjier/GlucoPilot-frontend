/** 频道 / 展示字段映射（后端数字枚举 ↔ 前端文案） */

const CHANNEL_CODE_TO_NAME = {
  1: '企业动态',
  2: '行业快讯',
  3: '设备新知',
  4: '控糖科普'
}

const CHANNEL_NAME_TO_CODE = {
  企业动态: 1,
  行业快讯: 2,
  设备新知: 3,
  控糖科普: 4
}

function formatNewsTime(publishAt) {
  if (!publishAt) return ''
  const s = String(publishAt).replace('T', ' ')
  return s.length > 16 ? s.slice(0, 16) : s
}

function mapBanner(item) {
  return {
    id: item.id,
    title: item.title || '',
    desc: item.subtitle || '',
    imageUrl: item.imageUrl || '',
    linkUrl: item.linkUrl || ''
  }
}

function mapNewsItem(item) {
  const channelCode = item.channelCode
  const contentType = item.contentType
  const isVideo = contentType === 2
  return {
    id: item.id,
    title: item.title || '',
    summary: item.summaryText || '',
    channel: CHANNEL_CODE_TO_NAME[channelCode] || '资讯',
    channelCode,
    type: isVideo ? 'video' : 'article',
    typeLabel: isVideo ? '视频' : '图文',
    time: formatNewsTime(item.publishAt),
    cover: item.coverUrl || '/assets/news/n1.jpg',
    coverText: isVideo ? '▶' : '资讯',
    videoUrl: item.videoUrl || '',
    contentBody: item.contentBody || '',
    likeCount: item.likeCount || 0,
    collectCount: item.collectCount || 0,
    liked: !!item.liked,
    collected: !!item.collected
  }
}

function mapFood(item) {
  return {
    id: item.id,
    name: item.foodName || '',
    carbs: item.carbsPer100g != null ? Number(item.carbsPer100g) : 0,
    cal: item.caloriesPer100g != null ? Number(item.caloriesPer100g) : 0,
    categoryCode: item.categoryCode,
    categoryId: item.categoryId,
    imageUrl: item.imageUrl || ''
  }
}

function mapFoodCategory(item) {
  return {
    id: item.id,
    name: item.categoryName || '',
    sortNo: item.sortNo
  }
}

module.exports = {
  CHANNEL_CODE_TO_NAME,
  CHANNEL_NAME_TO_CODE,
  mapBanner,
  mapNewsItem,
  mapFood,
  mapFoodCategory
}
