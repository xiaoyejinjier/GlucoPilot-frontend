const { applyDisplayToCurrentPage } = require('../../utils/display')

const DEMO_LIST = [
  {
    id: 1001,
    type: '产品建议',
    content: '希望统计页能导出 PDF，方便给医生看。',
    status: '已处理',
    time: '2026-09-06 14:20',
    officialReply: '感谢反馈，PDF 导出已列入后续版本计划，预计与后端联调后上线。'
  },
  {
    id: 1002,
    type: 'Bug问题',
    content: '拍照确认页偶尔黑屏，真机上比较明显。',
    status: '处理中',
    time: '2026-09-08 09:15'
  },
  {
    id: 1003,
    type: '功能诉求',
    content: '能否增加家属共享查看功能？',
    status: '已收到',
    time: '2026-09-09 18:40',
    officialReply: '已收到您的诉求，家属共享功能正在评估中，有进展会第一时间通知。'
  }
]

Page({
  data: {
    displayStyle: '',
    list: []
  },

  onShow() {
    applyDisplayToCurrentPage()
    let list = wx.getStorageSync('feedbackList') || []
    if (!list.length) {
      list = DEMO_LIST
    } else if (!list.some((item) => item.officialReply)) {
      // 本地已有留言但没有官方回复时，给第一条补一条示例回复便于预览
      list = list.map((item, index) => {
        if (index !== 0) return item
        return {
          ...item,
          status: '已处理',
          officialReply:
            '您好，感谢您的留言！我们已收到并核实，相关优化会在下个版本更新。如有疑问可继续在此留言。'
        }
      })
    }
    wx.setStorageSync('feedbackList', list)
    this.setData({ list })
  }
})
