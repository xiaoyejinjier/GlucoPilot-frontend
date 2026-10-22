/**
 * 媒体文件上传：**凭证 → 直传 → 登记**三步（顺序不可颠倒，见 GlucoPilot-backend 仓 docs/API-CONTRACT.md「对话与图片消息」）。
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
  CHAT_VOICE: 6,
  ARTICLE_IMAGE: 7, ARTICLE_VIDEO:8
}

/** 会话图片的客户端上限：5MB，与后端 `ai.vision.max-image-bytes` 对齐。
 *
 * 为什么要在客户端先拦：媒体接口本身允许 20MB，但视觉识别只吃 5MB。
 * 若等到 2.25 才由服务端拒绝，图片已经传完了、用户白等一场，体验很差。
 * ⚠️ 权威限制在服务端，这里只是提前反馈，不作为安全边界。
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 通用上传的客户端默认上限：20MB，与后端媒体接口上限对齐。 */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

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
 * 本地存储及 MinIO 同源代理地址必须显式使用 application/octet-stream。微信小程序默认会把未指定类型的
 * wx.request 当作 application/json；后端 JSON 请求过滤器随后按 UTF-8 读取请求体，会把
 * JPEG/PNG 的非法 UTF-8 字节替换掉，最终得到大小相近但已经打不开的损坏图片。
 *
 * 外部预签名 URL 则刻意不设置 Content-Type：阿里云 OSS 的 V1 签名会把 Content-Type
 * 计入待签串，签名时为空、上传时非空会触发 SignatureDoesNotMatch。
 */
function putToStorage(uploadUrl, arrayBuffer) {
  const isLocalBackendUpload = /\/api\/v1\/media-files\/(?:local|minio)-uploads\//.test(uploadUrl)
  return new Promise((resolve, reject) => {
    wx.request({
      url: uploadUrl,
      method: 'PUT',
      data: arrayBuffer,
      header: isLocalBackendUpload ? { 'Content-Type': 'application/octet-stream' } : {},
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
 * 通用三步上传：**凭证 → 直传 → 登记**，适用于任意 {@link BIZ_TYPE}（头像 1 / 餐食 3 / 会话图 4 ……）。
 *
 * 四个参数只取「bizType + 本地路径」，规则与后端媒体接口完全一致：大小默认 20MB 上限、
 * MIME 靠魔数嗅探（不信扩展名）、直传用 PUT+ArrayBuffer（两个坑见文件头注释）。
 *
 * @param {number} bizType MediaBizType 编码（见 {@link BIZ_TYPE}）
 * @param {string} filePath 本地临时文件路径（wx.chooseMedia 的 tempFilePath）
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=DEFAULT_MAX_BYTES] 客户端预检字节上限
 * @param {string} [opts.label='文件'] 超限提示里的资源名（如会话图传「图片」）
 * @returns {Promise<{id: (number|string), fileUrl: string}>} 登记的 media_file（含 id 供业务引用）
 */
function uploadMediaFile(bizType, filePath, opts) {
  const maxBytes = (opts && opts.maxBytes) || DEFAULT_MAX_BYTES
  const label = (opts && opts.label) || '文件'
  let arrayBuffer
  let mimeType
  const requireCurrent = () => { if (opts && opts.isCurrent && !opts.isCurrent()) throw new Error('账号或页面已变化，请重新选择文件') }

  return readFileAsArrayBuffer(filePath)
    .then((buf) => {
      requireCurrent()
      arrayBuffer = buf
      const sizeBytes = buf.byteLength
      if (sizeBytes > maxBytes) {
        throw new Error(`${label}不能超过 ${Math.floor(maxBytes / 1024 / 1024)}MB，请压缩后重试`)
      }
      mimeType = bizType === BIZ_TYPE.ARTICLE_VIDEO ? sniffVideoMime(buf) : sniffImageMime(buf)
      if (!mimeType) {
        throw new Error(bizType === BIZ_TYPE.ARTICLE_VIDEO ? '仅支持MP4视频，请转换格式后上传' : '仅支持 JPG / PNG / GIF / WebP 格式的图片')
      }
      return api.createMediaUploadCredential(bizType, mimeType, sizeBytes)
    })
    .then((cred) => {
      requireCurrent()
      return putToStorage(cred.uploadUrl, arrayBuffer).then(() => ({
        storageKey: cred.storageKey,
        sizeBytes: arrayBuffer.byteLength
      }))
    })
    .then((uploaded) => {
      requireCurrent()
      return api.registerMediaFile({
        bizType,
        storageKey: uploaded.storageKey,
        mimeType,
        sizeBytes: uploaded.sizeBytes
      })
    })
}

/**
 * 上传一张会话图片，返回登记的 media_file（含 id，即 2.24 需要的 mediaId）。
 * 直接委托通用 {@link uploadMediaFile}：本函数只是把 bizType 固定为聊天图并套用 5MB 上限。
 *
 * @param {string} filePath 本地临时文件路径（wx.chooseMedia 的 tempFilePath）
 * @returns {Promise<{id: (number|string), fileUrl: string}>}
 */
function uploadChatImage(filePath) {
  return uploadMediaFile(BIZ_TYPE.CHAT_IMAGE, filePath, { maxBytes: MAX_IMAGE_BYTES, label: '图片' })
}

/** 上传血糖仪照片，返回可供 OCR 任务引用的 GLUCOSE mediaId。 */
function uploadGlucoseImage(filePath) {
  return uploadMediaFile(BIZ_TYPE.GLUCOSE, filePath, { maxBytes: MAX_IMAGE_BYTES, label: '血糖仪照片' })
}

/** 上传正餐照片，返回可供 meal-records 引用的 MEAL mediaId。 */
function uploadMealImage(filePath) {
  return uploadMediaFile(BIZ_TYPE.MEAL, filePath, { maxBytes: MAX_IMAGE_BYTES, label: '餐食照片' })
}

function sniffVideoMime(buffer) {
  const b=new Uint8Array(buffer.slice(0,64))
  if(b.length<12 || String.fromCharCode(...b.slice(4,8))!=='ftyp')return ''
  const brands=String.fromCharCode(...b.slice(8))
  return /isom|iso[2-9]|mp4[12]|avc1|M4V /.test(brands) && !/heic|heix|avif|qt  /.test(brands) ? 'video/mp4' : ''
}
module.exports = { sniffVideoMime,
  BIZ_TYPE,
  MAX_IMAGE_BYTES,
  DEFAULT_MAX_BYTES,
  uploadChatImage,
  uploadMediaFile,
  uploadGlucoseImage,
  uploadMealImage,
  sniffImageMime
}
