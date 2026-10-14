const { upsertGlucoseRecord } = require('../../services/api')
const { getTodayKey, saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')
const { getToken } = require('../../utils/request')
const { readPendingOcr, clearPendingOcr } = require('../../utils/ocr/index')
const { getNodeRecordWindow } = require('../../utils/record-window')

const { GLUCOSE_NODES } = require('../../utils/constants')

const MEAL_NODES = GLUCOSE_NODES.filter((n) => n.isMeal).map((n) => n.id)

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    recognitionStatus: 'none',
    recognizedValue: '',
    confidence: 0,
    rawText: '',
    recognitionMessage: '',
    mediaId: '',
    value: '',
    manualEdit: true,
    busy: false
  },

  onLoad(options) {
    const nodeId = options.nodeId || 'after_breakfast'
    const nodeName = decodeURIComponent(options.nodeName || '早餐后')
    const imagePath = readShotImage()
    const ocr = readPendingOcr() || {}
    const recognized = ocr.status === 'success' ? ocr.suggestedValue : ''

    this.setData({
      nodeId,
      nodeName,
      recognitionStatus: ocr.status || 'none',
      recognizedValue: recognized,
      confidence: ocr.confidence || 0,
      rawText: ocr.rawText || '',
      recognitionMessage: ocr.errorMessage || '',
      mediaId: ocr.mediaId || '',
      value: recognized,
      manualEdit: !recognized,
      imagePath
    })
    wx.setNavigationBarTitle({ title: nodeName + ' · 确认入库' })
    this.rejectClosedWindow(nodeId)
  },

  onShow() {
    applyDisplayToCurrentPage()
    const path = readShotImage()
    if (path && path !== this.data.imagePath) {
      this.setData({ imagePath: path })
    }
  },

  onBack() {
    if (this.data.busy) return
    clearPendingOcr()
    clearShotImage()
    wx.navigateBack()
  },

  onUseManual() {
    this.setData({ manualEdit: true, value: '' })
  },

  onAcceptRecognized() {
    if (!this.data.recognizedValue) return
    this.setData({ manualEdit: false, value: this.data.recognizedValue }, () => this.onConfirm())
  },

  onValueInput(e) {
    this.setData({ value: e.detail.value })
  },

  onConfirm() {
    if (this.data.busy) return

    if (this.rejectClosedWindow(this.data.nodeId)) return

    if (!getToken()) {
      wx.showModal({
        title: '登录已失效',
        content: '重新登录后才能把血糖记录保存到数据库。',
        showCancel: false,
        success: () => wx.reLaunch({ url: '/pages/login/login' })
      })
      return
    }

    const nodeId = this.data.nodeId
    // 餐点节点应走 food-confirm / food-analysis 流程，避免误写进血糖记录。
    if (MEAL_NODES.indexOf(nodeId) >= 0) {
      wx.showToast({ title: '请从正餐拍照入口记录', icon: 'none' })
      return
    }

    const value = parseFloat(this.data.value)
    if (isNaN(value) || value <= 0 || value >= 40) {
      wx.showToast({ title: '请输入有效血糖值', icon: 'none' })
      return
    }

    this.setData({ busy: true })
    const recordDate = getTodayKey()
    upsertGlucoseRecord({
      recordDate,
      nodeCode: nodeId,
      glucoseValue: value,
      sourceType: this.data.manualEdit ? 1 : 2,
      mediaId: this.data.mediaId || undefined
    })
      .then(() => {
        clearShotImage()
        clearPendingOcr()
        saveRecord(nodeId, { value, type: 'glucose' }, recordDate)
        wx.showToast({ title: '保存成功', icon: 'success' })
        setTimeout(() => {
          this.setData({ busy: false })
          wx.switchTab({ url: '/pages/ai/ai' })
        }, 800)
      })
      .catch((err) => {
        this.setData({ busy: false })
        if (err && err.code === 40100) {
          wx.showModal({
            title: '登录已失效',
            content: '请重新登录后再次保存血糖记录。',
            showCancel: false,
            success: () => wx.reLaunch({ url: '/pages/login/login' })
          })
          return
        }
        if (err && err.network) {
          wx.showModal({
            title: '无法连接后端',
            content: '请确认后端 8080 已启动，并且手机与电脑处于同一网络后重试。',
            showCancel: false
          })
          return
        }
        wx.showToast({ title: err.message || '血糖保存失败', icon: 'none' })
      })
  },

  rejectClosedWindow(nodeId) {
    const recordWindow = getNodeRecordWindow(nodeId, new Date())
    if (!recordWindow.locked) return false
    if (this._windowModalVisible) return true
    this._windowModalVisible = true
    wx.showModal({
      title: '该时段已截止',
      content: recordWindow.lockReason,
      showCancel: false,
      confirmText: '返回记录页',
      complete: () => {
        this._windowModalVisible = false
        clearShotImage()
        clearPendingOcr()
        wx.switchTab({ url: '/pages/ai/ai' })
      }
    })
    return true
  }
})
