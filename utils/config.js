/**
 * 联调配置。真机请改成电脑局域网 IP，并在开发者工具关闭「校验合法域名」。
 */
const config = {
  baseUrl: 'http://192.168.101.147:8080/api/v1',
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}

module.exports = config
