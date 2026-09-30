/**
 * 媒体文件上传：**凭证 → 直传 → 登记**三步（顺序不可颠倒，见 docs/API-CONTRACT.md「对话与图片消息」）。
 *
 * 两个必须绕开的坑，都写在代码旁边免得后人重踩：
 *
 * 1. **直传不能复用 utils/request**：那一步打的是对象存储的预签名 URL，不是我们的后端，
 *    返回的是**裸 2xx（空 body）**，没有 ApiResponse 信封；而 request() 要求 body.code === 0，
 *    会把成功的上传判成失败。所以这里自己发 wx.request 并只看 statusCode。
 *
 * 2. **不能用 wx.uploadFile**：它只支持 POST + multipart/form-data，
 *    而后端签出的是 **PUT** 预签名 URL（见 ObjectStorageService.createUploadCredential）。
 *    因此这里用 wx.request 直接发送 ArrayBuffer。
 */
const api = require('../services/api')

/** CodeEnum.MediaBizType，与后端保持一致。 */
const BIZ_TYPE = {
  AVATAR: 1,
  GLUCOSE: 2,
  MEAL: 3,
  CHAT_IMAGE: 4,
  CMS: 5,
  CHAT_VOICE: 6
}

/**
 * 会话图片的客户端上限：5MB，与后端 `ai.vision.max-image-bytes` 对齐。
 *
 * 为什么要在客户端先拦：媒体接口本身允许 20MB，但视觉识别只吃 5MB。
 * 若等到 2.25 才由服务端拒绝，图片已经传完了、用户白等一场，体验很差。
 * ⚠️ 权威限制在服务端，这里只是提前反馈，不作为安全边界。
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 读取本地文件为 ArrayBuffer（不传 encoding 即以二进制读取）。 */
function readFileAsArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: (err) => reject(new Error((err && err.errMsg) || '读取图片失败'))
    })
  })
}

/**
 * 直传对象存储。**只看 HTTP 状态码**，不解析 body —— 预签名 URL 的响应没有业务信封。
 *
 * 刻意不设置 Content-Type：预签名 URL 的签名范围只含 host（实测 X-Amz-SignedHeaders=host），
 * 但阿里云 OSS 的 V1 签名会把 Content-Type 计入待签串，签名时为空、上传时非空就会
 * SignatureDoesNotMatch。真正对业务有用的 MIME 是 2.15 登记进 media_file.mime_type 的那个，
 * 与对象自身的 Content-Type 无关（视觉模型用的是库里那个值）。
 */
function putToStorage(uploadUrl, arrayBuffer) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: uploadUrl,
      method: 'PUT',
      data: arrayBuffer,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res)
          return
        }
        // 对象存储的错误体是 XML（如 SignatureDoesNotMatch / AccessDenied），
        // 带上它能把「上传失败(403)」变成可直接定位的原因，省掉一轮瞎猜
        const detail = typeof res.data === 'string' ? res.data.replace(/\s+/g, ' ').slice(0, 200) : ''
        reject(new Error(`图片上传失败(${res.statusCode})${detail ? '：' + detail : ''}`))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '图片上传失败，请检查网络'))
    })
  })
}

/**
 * 按**文件魔数**判断真实 MIME，而不是信扩展名。
 *
 * 小程序临时文件的后缀由拍摄/相册来源决定，可能和真实格式不符（例如 PNG 存成 .jpg）。
 * 这个 MIME 会随 2.15 登记落库，再作为 data URI 的类型送给视觉模型——传错会让模型
 * 按错误的格式解析。魔数只用前 12 个字节，代价可忽略。
 *
 * @returns {string} 白名单内的 MIME；识别不了返回空串
 */
function sniffImageMime(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer.slice(0, 12))
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  // GIF: 'GIF'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  // WebP: 'RIFF' .... 'WEBP'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return ''
}

/**
 * 上传一张会话图片，返回登记的 media_file（含 id，即 2.24 需要的 mediaId）。
 *
 * @param {string} filePath 本地临时文件路径（wx.chooseMedia 的 tempFilePath）
 * @returns {Promise<{id: (number|string), fileUrl: string}>}
 */
function uploadChatImage(filePath) {
  let arrayBuffer
  let mimeType

  return readFileAsArrayBuffer(filePath)
    .then((buf) => {
      arrayBuffer = buf
      const sizeBytes = buf.byteLength
      if (sizeBytes > MAX_IMAGE_BYTES) {
        throw new Error(`图片不能超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB，请压缩后重试`)
      }
      mimeType = sniffImageMime(buf)
      if (!mimeType) {
        throw new Error('仅支持 JPG / PNG / GIF / WebP 格式的图片')
      }
      return api.createMediaUploadCredential(BIZ_TYPE.CHAT_IMAGE, mimeType, sizeBytes)
    })
    .then((cred) =>
      putToStorage(cred.uploadUrl, arrayBuffer).then(() => ({
        storageKey: cred.storageKey,
        sizeBytes: arrayBuffer.byteLength
      }))
    )
    .then((uploaded) =>
      api.registerMediaFile({
        bizType: BIZ_TYPE.CHAT_IMAGE,
        storageKey: uploaded.storageKey,
        mimeType,
        sizeBytes: uploaded.sizeBytes
      })
    )
}

module.exports = {
  BIZ_TYPE,
  MAX_IMAGE_BYTES,
  uploadChatImage,
  sniffImageMime
}
