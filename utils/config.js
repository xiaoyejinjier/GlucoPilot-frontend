/**
 * 联调配置。
 *
 * baseUrl 按运行环境自动切换，避免每次「模拟器 ↔ 真机」来回手改：
 *  - 微信开发者工具：模拟器跑在电脑上，127.0.0.1 就是后端所在机器；
 *  - 真机预览/体验版：手机上的 127.0.0.1 指向手机自己，必须用**电脑的局域网 IP**（手机与电脑同一 Wi-Fi）。
 *
 * 换网络后 lanHost 会变（尤其连手机热点时），更新方法：
 *   Windows 执行 ipconfig，取「无线局域网适配器 WLAN」那一项的 IPv4 地址。
 *   ⚠️ 别用 VMware(VMnet 192.168.x.1) / Radmin 等虚拟网卡的地址，手机连不上。
 *
 * 两种环境都要在开发者工具「详情 → 本地设置」勾选**不校验合法域名**
 * （project.config.json 里 urlCheck 为 true）。
 */

const PORT = 8080

/** 真机联调用：电脑 WLAN 的 IPv4。换网络后改这里 */
const LAN_HOST = '172.20.10.2'

/**
 * 视为「跑在后端同一台机器上」的平台：开发者工具，以及 PC 端微信（windows/mac）。
 * 这些环境用 127.0.0.1；手机（ios/android/harmonyos 等）用 LAN_HOST。
 * 同时兼容两种取平台的方式，避免某一版基础库返回值不同导致判断失效。
 */
const LOCAL_PLATFORMS = ['devtools', 'windows', 'mac']

function detectPlatform() {
  try {
    if (typeof wx !== 'undefined') {
      if (typeof wx.getDeviceInfo === 'function') {
        return (wx.getDeviceInfo() || {}).platform || ''
      }
      if (typeof wx.getSystemInfoSync === 'function') {
        return (wx.getSystemInfoSync() || {}).platform || ''
      }
    }
  } catch (e) {
    // 取不到平台信息时按真机处理（局域网地址在两种环境里更通用）
  }
  return ''
}

const platform = detectPlatform()
const isLocalMachine = LOCAL_PLATFORMS.indexOf(platform) >= 0
const host = isLocalMachine ? '127.0.0.1' : LAN_HOST

const config = {
  /** 解析结果示例：http://127.0.0.1:8080/api/v1 或 http://172.20.10.2:8080/api/v1 */
  baseUrl: `http://${host}:${PORT}/api/v1`,
  /** 当前平台与判定结果，排查连不上时先在控制台看这两个值 */
  platform,
  isLocalMachine,
  lanHost: LAN_HOST,
  /** 接口失败时首页/营养库是否回退本地演示数据 */
  fallbackLocal: true
}

module.exports = config
