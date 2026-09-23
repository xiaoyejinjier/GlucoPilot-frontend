/**
 * 唯一的 C 端 API 配置入口。
 *
 * 开发机或真机联调时，在 Storage 写入 apiBaseUrl 即可切换到团队远程环境，
 * 不要在页面、service 或 request 中散落服务器地址。生产小程序必须使用
 * 已在微信公众平台登记的 HTTPS 域名。
 */
const defaultBaseUrl = 'https://api.example.com/api/v1'
const runtimeBaseUrl = wx.getStorageSync('apiBaseUrl')

const config = {
  baseUrl: String(runtimeBaseUrl || defaultBaseUrl).replace(/\/$/, ''),
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}

module.exports = config
