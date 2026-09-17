/** 拍照临时图读写：优先本地持久化，避免确认页黑屏 */
const STORAGE_KEY = 'pendingShotImage'

function persistShotImage(tempPath) {
  return new Promise((resolve) => {
    if (!tempPath) {
      clearShotImage()
      resolve('')
      return
    }

    const app = getApp()
    if (app && app.globalData) app.globalData.pendingShotImage = tempPath
    try {
      wx.setStorageSync(STORAGE_KEY, tempPath)
    } catch (e) { /* ignore */ }

    const fs = wx.getFileSystemManager()
    // saveFile 会把临时文件转成本地缓存路径，真机上更稳
    fs.saveFile({
      tempFilePath: tempPath,
      success: (res) => {
        const path = res.savedFilePath || tempPath
        if (app && app.globalData) app.globalData.pendingShotImage = path
        try {
          wx.setStorageSync(STORAGE_KEY, path)
        } catch (e) { /* ignore */ }
        resolve(path)
      },
      fail: () => {
        // 部分机型 saveFile 失败时，尝试 copy 到 USER_DATA_PATH
        const dest = `${wx.env.USER_DATA_PATH}/shot_${Date.now()}.jpg`
        fs.copyFile({
          srcPath: tempPath,
          destPath: dest,
          success: () => {
            if (app && app.globalData) app.globalData.pendingShotImage = dest
            try {
              wx.setStorageSync(STORAGE_KEY, dest)
            } catch (e) { /* ignore */ }
            resolve(dest)
          },
          fail: () => resolve(tempPath)
        })
      }
    })
  })
}

function readShotImage() {
  const app = getApp()
  const fromGlobal = app && app.globalData && app.globalData.pendingShotImage
  if (fromGlobal) return fromGlobal
  try {
    return wx.getStorageSync(STORAGE_KEY) || ''
  } catch (e) {
    return ''
  }
}

function clearShotImage() {
  const app = getApp()
  if (app && app.globalData) app.globalData.pendingShotImage = ''
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) { /* ignore */ }
}

module.exports = {
  persistShotImage,
  readShotImage,
  clearShotImage
}
