const { applyDisplayToCurrentPage } = require('../../utils/display')
const { persistShotImage } = require('../../utils/shot')

const AI_REPLIES = [
  '结合你今日早餐后 7.6 mmol/L，建议晚餐减少精制主食，增加蔬菜比例。仅供参考。',
  '苹果建议半个左右，最好在两餐之间食用。血糖监测后如有异常请咨询医师。',
  '根据你的记录，近7日平均血糖 6.7 mmol/L，整体控制良好，继续保持。',
  '低 GI 主食如燕麦、糙米是更好的选择，建议逐步替换白米饭。',
  '已收到您发送的图片，从餐盘来看建议控制主食份量，并增加绿叶蔬菜。仅供参考。'
]

Page({
  data: {
    displayStyle: '',
    currentTime: '09:41',
    inputValue: '',
    scrollIntoView: '',
    voiceMode: false,
    recording: false,
    messages: [
      { id: 1, role: 'ai', type: 'text', content: '你好，我是 AI 控糖助手。可以问饮食、血糖或今日记录相关问题。' },
      { id: 2, role: 'user', type: 'text', content: '我现在血糖偏高，晚饭怎么吃比较好？' },
      { id: 3, role: 'ai', type: 'text', content: '结合你今日早餐后 7.6 mmol/L，苹果建议半个左右。仅供参考。' }
    ],
    replyIndex: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    applyDisplayToCurrentPage()
    const now = new Date()
    this.setData({
      currentTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  onToggleVoiceMode() {
    this.setData({ voiceMode: !this.data.voiceMode, recording: false })
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        persistShotImage(path).then((savedPath) => {
          this.sendImage(savedPath || path)
        })
      }
    })
  },

  onPreviewImage(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    wx.previewImage({ urls: [src], current: src })
  },

  onHoldStart() {
    if (!this.data.voiceMode || this.data.recording) return
    this.setData({ recording: true })
  },

  onHoldEnd() {
    if (!this.data.voiceMode || !this.data.recording) return
    this.setData({ recording: false })
    const text = '帮我看看今天的血糖是否偏高'
    this.setData({ inputValue: text })
    this.sendText(text)
  },

  onSend() {
    const text = this.data.inputValue.trim()
    if (!text) return
    this.sendText(text)
  },

  sendText(text) {
    const messages = [...this.data.messages, { id: Date.now(), role: 'user', type: 'text', content: text }]
    this.setData({ messages, inputValue: '', scrollIntoView: 'msg-bottom' })
    this.replyAfterUser(false)
  },

  sendImage(imagePath) {
    const messages = [...this.data.messages, { id: Date.now(), role: 'user', type: 'image', imagePath }]
    this.setData({ messages, scrollIntoView: 'msg-bottom' })
    this.replyAfterUser(true)
  },

  replyAfterUser(isImage) {
    setTimeout(() => {
      const idx = isImage ? 4 : this.data.replyIndex % 4
      const reply = AI_REPLIES[idx]
      const updated = [...this.data.messages, { id: Date.now() + 1, role: 'ai', type: 'text', content: reply }]
      this.setData({
        messages: updated,
        replyIndex: this.data.replyIndex + 1,
        scrollIntoView: 'msg-bottom'
      })
    }, 450)
  }
})
