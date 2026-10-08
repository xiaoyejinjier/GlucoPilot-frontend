const { upsertGlucoseRecord } = require('../../services/api')
const { getTodayKey, saveRecord } = require('../../utils/storage')
const { applyDisplayToCurrentPage } = require('../../utils/display')
const { readShotImage, clearShotImage } = require('../../utils/shot')
const { getToken } = require('../../utils/request')

const { GLUCOSE_NODES } = require('../../utils/constants')

const MEAL_NODES = GLUCOSE_NODES.filter((n) => n.isMeal).map((n) => n.id)

Page({
  data: {
    displayStyle: '',
    nodeId: '',
    nodeName: '',
    imagePath: '',
    /** 没有识别结果时留空，必须由用户输入（本项目尚未接入 OCR） */
    value: '',
    manualEdit: true,
    busy: false
  },

  onLoad(options) {
    const nodeName = decodeURIComponent(options.nodeName || '早餐后')
    const imagePath = readShotImage()
    /** 传入 value 时视为已有识别结果（供将来接入 OCR 用），否则直接进编辑态 */
    const recognized = options.value || ''

    this.setData({
      nodeId: options.nodeId || 'after_breakfast',
      nodeName,
      value: recognized,
      manualEdit: !recognized,
      imagePath
    })
    wx.setNavigationBarTitle({ title: nodeName + ' · 确认入库' })
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
    wx.navigateBack()
  },

  onToggleManual() {
    this.setData({ manualEdit: !this.data.manualEdit })
  },

  onValueInput(e) {
    this.setData({ value: e.detail.value })
  },

  onConfirm() {
    if (this.data.busy) return

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
    // 餐点节点走饮食记录，本期后端未实现，先明确提示而不是静默丢弃
    if (MEAL_NODES.indexOf(nodeId) >= 0) {
      wx.showToast({ title: '餐点记录功能尚未开放', icon: 'none' })
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
      // 数值由用户自己输入，标 MANUAL(1)。接上真 OCR 后再改用 2(OCR)。
      sourceType: 1
    })
      .then(() => {
        clearShotImage()
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
  }
})
