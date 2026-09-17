/** 九时段节点定义 */
const GLUCOSE_NODES = [
  { id: 'before_breakfast', name: '早餐前', short: '早前' },
  { id: 'breakfast', name: '早餐', short: '早点', isMeal: true },
  { id: 'after_breakfast', name: '早餐后', short: '早后' },
  { id: 'before_lunch', name: '中餐前', short: '中前' },
  { id: 'lunch', name: '中餐', short: '中点', isMeal: true },
  { id: 'after_lunch', name: '中餐后', short: '中后' },
  { id: 'before_dinner', name: '晚餐前', short: '晚前' },
  { id: 'dinner', name: '晚餐', short: '晚点', isMeal: true },
  { id: 'after_dinner', name: '晚餐后', short: '晚后' }
]

/** 根据血糖值返回状态 */
function getGlucoseStatus(value) {
  if (value == null || value === '') return 'empty'
  const v = parseFloat(value)
  if (v < 3.9 || v >= 10) return 'danger'
  if (v >= 7.8) return 'warn'
  return 'ok'
}

/** 资讯频道 */
const NEWS_CHANNELS = ['企业动态', '行业快讯', '设备新知', '控糖科普']

/** 模拟资讯数据 */
const NEWS_LIST = [
  {
    id: 1,
    title: '餐后血糖为什么会飙升？三步稳住波动',
    summary: '餐后血糖波动常见于精制主食过量与进餐过快。',
    channel: '控糖科普',
    type: 'article',
    typeLabel: '图文',
    time: '今天 09:20',
    coverText: '科普',
    cover: '/assets/news/n1.jpg'
  },
  {
    id: 2,
    title: '指血与 CGM 怎么配合使用更省心',
    summary: '指血校准准、CGM 看趋势。点进可播放演示视频。',
    channel: '设备新知',
    type: 'video',
    typeLabel: '视频',
    time: '昨天',
    coverText: '▶',
    cover: '/assets/news/n2.jpg',
    videoUrl: '/assets/video/demo.mp4'
  },
  {
    id: 3,
    title: '慧科未来发布 AI 控糖助手 2.0',
    summary: '全新九时段记录与饮食两段式预测功能上线。',
    channel: '企业动态',
    type: 'article',
    typeLabel: '图文',
    time: '3天前',
    coverText: '动态',
    cover: '/assets/news/n3.jpg'
  },
  {
    id: 4,
    title: '2026 糖尿病管理行业白皮书解读',
    summary: '数字化健康管理成为行业新趋势。',
    channel: '行业快讯',
    type: 'article',
    typeLabel: '图文',
    time: '1周前',
    coverText: '快讯',
    cover: '/assets/news/n4.jpg'
  }
]

/** Banner 轮播 */
const BANNERS = [
  { title: '慧科未来', desc: '移动互联网 + 健康管理' },
  { title: 'AI 控糖助手', desc: '记录 · 分析 · 建议 · 追踪' },
  { title: '九时段精准记录', desc: '拍照识别 · 智能分析' },
  { title: '饮食两段式预测', desc: '科学控糖 · 健康生活' }
]

/** 食物大类 */
const FOOD_CATEGORIES = [
  '主食类', '肉蛋类', '蔬菜类', '水果类', '奶类',
  '豆制品', '坚果类', '饮料类', '零食及其他'
]

/** 反馈类型 */
const FEEDBACK_TYPES = ['产品建议', 'Bug问题', '功能诉求', '其他']

/** 免责声明内容 */
const DISCLAIMER_CONTENT = [
  '本应用为健康管理工具，不提供医疗诊断、治疗或处方服务。',
  'AI 识别、血糖预测、饮食建议与问答结果仅供健康管理参考，不构成医疗建议。',
  '用户上传的血糖、饮食、报告等个人健康信息，将在授权范围内用于个性化分析。',
  '请确保拍照内容清晰完整。识别结果可能存在误差，入库前必须由您本人确认或修改。',
  '如遇紧急情况或身体异常，请立即就医并遵循专业医师指导。',
  '使用本应用即表示您已阅读并理解以上条款。'
]

module.exports = {
  GLUCOSE_NODES,
  getGlucoseStatus,
  NEWS_CHANNELS,
  NEWS_LIST,
  BANNERS,
  FOOD_CATEGORIES,
  FEEDBACK_TYPES,
  DISCLAIMER_CONTENT
}
