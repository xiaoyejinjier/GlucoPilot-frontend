Page({
  data: {
    phone: '138****8000'
  },

  onBindPhone() {
    wx.showModal({
      title: '绑定手机号',
      content: '当前演示号：' + this.data.phone,
      showCancel: false
    })
  },

  onChangePwd() {
    wx.showModal({
      title: '验证码保护',
      content: '敏感操作需短信验证码确认（原型已默认开启）',
      showCancel: false
    })
  }
})
