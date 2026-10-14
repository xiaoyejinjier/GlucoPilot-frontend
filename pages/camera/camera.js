const { GLUCOSE_NODES } = require('../../utils/constants')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { persistShotImage } = require('../../utils/shot')
const { recognizeGlucoseImage } = require('../../utils/ocr/index')
const { getNodeRecordWindow } = require('../../utils/record-window')

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    isMeal: false,
    busy: false,
    isDevtools: false,
    useLiveCamera: false,
    blocked: false,
    needAuth: false,
    cameraTip: '',
    devicePosition: 'back'
  },

  cameraCtx: null,

  onLoad(options) {
    const nodeId = options.nodeId || 'after_breakfast'
    const isMeal = options.isMeal === '1' || options.isMeal === true
    const node = GLUCOSE_NODES.find(n => n.id === nodeId) || GLUCOSE_NODES[2]
    const recordWindow = getNodeRecordWindow(node.id, new Date())
    const sys = wx.getSystemInfoSync() || {}
    const isDevtools = sys.platform === 'devtools'

    this.setData({
      nodeId: node.id,
      nodeName: decodeURIComponent(options.nodeName || node.name),
      isMeal: !!isMeal,
      isDevtools,
      useLiveCamera: false,
      blocked: recordWindow.locked,
      cameraTip: isDevtools
        ? '电脑端常会误开 OBS 等虚拟摄像头，画面会像刚才那样。请用手机「真机调试」预览。'
        : '正在申请摄像头权限…'
    })

    if (recordWindow.locked) {
      this.showWindowClosed(recordWindow.lockReason)
      return
    }

    if (!isDevtools) {
      this.ensureCameraAuth()
    }
  },

  onShow() {
    applyDisplayToCurrentPage()
  },

  ensureCameraAuth() {
    wx.getSetting({
      success: (res) => {
        const auth = res.authSetting['scope.camera']
        if (auth === false) {
          this.setData({
            useLiveCamera: false,
            needAuth: true,
            cameraTip: '需要摄像头权限才能拍照'
          })
          return
        }
        if (auth === true) {
          this.setData({ useLiveCamera: true, needAuth: false, cameraTip: '' })
          return
        }
        wx.authorize({
          scope: 'scope.camera',
          success: () => {
            this.setData({ useLiveCamera: true, needAuth: false, cameraTip: '' })
          },
          fail: () => {
            this.setData({
              useLiveCamera: false,
              needAuth: true,
              cameraTip: '需要摄像头权限才能拍照'
            })
          }
        })
      },
      fail: () => {
        this.setData({
          useLiveCamera: true,
          needAuth: false,
          cameraTip: ''
        })
      }
    })
  },

  onRequestAuth() {
    wx.openSetting({
      success: (res) => {
        if (res.authSetting['scope.camera']) {
          this.setData({ useLiveCamera: true, needAuth: false, cameraTip: '' })
        }
      }
    })
  },

  onCameraInit() {
    this.cameraCtx = wx.createCameraContext('shotCam')
  },

  onCameraError() {
    this.setData({
      useLiveCamera: false,
      needAuth: true,
      cameraTip: '摄像头打开失败，请检查权限或换真机预览'
    })
  },

  onClose() {
    if (this.data.busy) return
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/ai/ai' }) })
  },

  showWindowClosed(reason) {
    if (this._windowModalVisible) return
    this._windowModalVisible = true
    wx.showModal({
      title: '该时段已截止',
      content: reason || '请返回记录页选择当前可记录的时段。',
      showCancel: false,
      confirmText: '返回记录页',
      complete: () => {
        this._windowModalVisible = false
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/ai/ai' }) })
      }
    })
  },

  ensureNodeOpen() {
    const recordWindow = getNodeRecordWindow(this.data.nodeId, new Date())
    if (!recordWindow.locked) return true
    this.setData({ blocked: true, useLiveCamera: false, busy: false })
    this.showWindowClosed(recordWindow.lockReason)
    return false
  },

  onAlbum() {
    if (this.data.busy || !this.ensureNodeOpen()) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        this.afterShot(path || '')
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') !== -1) return
        wx.showToast({ title: '未选择图片', icon: 'none' })
      }
    })
  },

  onCapture() {
    if (this.data.busy || !this.ensureNodeOpen()) return

    if (this.data.isDevtools || !this.data.useLiveCamera) {
      wx.showModal({
        title: this.data.isDevtools ? '模拟器无真机摄像头' : '摄像头未就绪',
        content: this.data.isDevtools
          ? '刚才那个 OBS 圆标是电脑虚拟摄像头，不是本 App 的图。请用真机调试，或先用相册选图继续演示。'
          : '请先授权摄像头，或改用相册选图。',
        confirmText: '相册选图',
        cancelText: this.data.isDevtools ? '演示跳过' : '取消',
        success: (res) => {
          if (res.confirm) {
            this.onAlbum()
          } else if (res.cancel && this.data.isDevtools) {
            this.afterShot('')
          }
        }
      })
      return
    }

    if (!this.cameraCtx) {
      this.cameraCtx = wx.createCameraContext('shotCam')
    }
    this.setData({ busy: true })
    this.cameraCtx.takePhoto({
      quality: 'high',
      success: (res) => {
        this.afterShot(res.tempImagePath || '')
      },
      fail: () => {
        this.setData({ busy: false })
        wx.showToast({ title: '拍照失败', icon: 'none' })
      }
    })
  },

  afterShot(imagePath) {
    if (!this.ensureNodeOpen()) return
    if (this.data.isMeal) {
      this.goNext(imagePath)
      return
    }

    this.setData({ busy: true })
    wx.showLoading({ title: '上传并识别中...', mask: true })
    persistShotImage(imagePath)
      .then((savedPath) => recognizeGlucoseImage(savedPath || imagePath))
      .then(() => {
        wx.hideLoading()
        this.goNext(imagePath, true)
      })
  },

  goNext(imagePath, alreadyPersisted) {
    const { nodeId, nodeName, isMeal } = this.data
    const name = encodeURIComponent(nodeName || '')
    const done = () => this.setData({ busy: false })

    wx.showLoading({ title: '处理中...', mask: true })
    const persist = alreadyPersisted ? Promise.resolve(imagePath) : persistShotImage(imagePath)
    persist.then(() => {
      wx.hideLoading()
      if (isMeal) {
        wx.navigateTo({
          url: `/pages/food-confirm/food-confirm?nodeId=${nodeId}&nodeName=${name}`,
          complete: done,
          fail: done
        })
      } else {
        wx.navigateTo({
          url: `/pages/confirm/confirm?nodeId=${nodeId}&nodeName=${name}`,
          complete: done,
          fail: done
        })
      }
    })
  }
})
