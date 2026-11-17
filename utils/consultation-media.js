const { getToken } = require('./request')
const config = require('./config')
// 健康图片仅通过本人鉴权接口下载；不持久缓存，不回退到公开桶地址。
function loadPhoto(url) {
  if (!/^\/api\/v1\/(?:consultations\/[1-9]\d*\/images\/[1-9]\d*|consultation-media\/[1-9]\d*)$/.test(url || ''))
    return Promise.reject(new Error('问诊图片地址无效'))
  const token=getToken()
  return new Promise((resolve,reject)=>wx.downloadFile({url:String(config.baseUrl).replace(/\/+$/,'')+url.slice('/api/v1'.length),
    header:{Authorization:`Bearer ${token}`},timeout:15000,
    success:result=>{if(getToken()!==token)return reject(new Error('登录状态已变化'));if(result.statusCode===200&&result.tempFilePath)resolve(result.tempFilePath);else reject(new Error('问诊图片加载失败'))},fail:()=>reject(new Error('问诊图片加载失败'))}))
}
module.exports={loadPhoto}
