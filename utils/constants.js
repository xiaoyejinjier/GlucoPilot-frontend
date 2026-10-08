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
  '本应用是一款面向日常血糖记录、饮食管理和健康趋势查看的辅助工具，不属于医疗器械，也不提供疾病诊断、治疗方案、处方开具或替代医生诊疗等医疗服务。',
  '应用展示的 AI 识别结果、血糖趋势、风险提示、饮食分析、营养建议及问答内容，均由算法依据用户提交的信息生成，仅供个人健康管理参考，不应作为自行调整药物、胰岛素剂量或治疗方案的依据。',
  '拍照识别可能受到光线、角度、清晰度、设备型号、试纸显示效果及网络状态等因素影响，可能出现数值或时段识别错误。每次保存前，请务必由本人核对血糖值、记录日期和所属时段。',
  '血糖仪、动态血糖监测设备与本应用之间可能存在测量或同步差异。如应用记录与实际设备读数不一致，应以合格设备的原始读数及专业医务人员意见为准。',
  '用户应如实填写年龄、糖尿病类型、用药情况、运动习惯及其他健康资料。资料缺失、不准确或未及时更新，可能影响统计结果和个性化建议的准确性。',
  '用户上传或填写的头像、血糖、饮食、健康档案和反馈等信息，将在实现账户服务、数据同步、趋势分析和功能改进所必需的范围内进行处理，并按照适用的隐私保护要求采取合理安全措施。',
  '请妥善保管登录设备、验证码及账户信息，不要在公共设备上长期保留登录状态。因用户主动共享账户、设备遗失或未及时退出登录造成的信息泄露风险，由用户及时联系服务方协助处理。',
  '受网络中断、服务器维护、第三方服务异常、设备兼容性等因素影响，部分功能可能暂时不可用或出现数据延迟。重要健康数据建议同时保留血糖仪记录、纸质记录或其他可靠备份。',
  '若出现严重低血糖或高血糖症状、意识异常、呼吸困难、持续呕吐等紧急情况，请立即停止依赖本应用，及时联系急救机构或前往医疗机构就诊。',
  '未成年人、孕妇、老年人以及患有严重基础疾病的用户，应在监护人或专业医务人员指导下使用本应用，不应仅依据应用结果作出健康或治疗决定。',
  '继续使用并点击“我已阅读并同意”，表示您已完整阅读、理解并接受以上服务边界与风险提示。如不同意其中任何内容，请停止使用相关功能。'
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
