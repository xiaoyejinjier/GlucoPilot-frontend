const config = require('./config')
const { getToken } = require('./request')
function downloadExport(id) {
  if(!/^[1-9]\d{0,18}$/.test(String(id)))return Promise.reject(new Error('导出任务不正确'))
  const token=getToken(),issue=typeof config.connectionIssue==='function'&&config.connectionIssue()
  if(!token||issue)return Promise.reject(new Error(issue||'请先登录'))
  return new Promise((resolve,reject)=>wx.downloadFile({url:`${config.baseUrl}/data-export-tasks/${id}/file`,header:{Authorization:`Bearer ${token}`},timeout:60000,
    success(result){if(result.statusCode!==200||token!==getToken()){if(result.tempFilePath)wx.getFileSystemManager().unlink({filePath:result.tempFilePath,fail(){}});reject(new Error(result.statusCode===401?'登录已失效，请重新登录':'文件尚未就绪或下载失败，请重试'));return}resolve(result.tempFilePath)},
    fail(){reject(new Error('文件下载失败，请检查网络后重试'))}
  }))
}
module.exports={downloadExport}
