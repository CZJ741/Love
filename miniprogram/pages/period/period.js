// 生理期 / 健康关怀前端逻辑
const api = require('../../lib/api')

Page({
  data: {
    loading: true,
    submitting: false,
    isFemale: true, // 视角：true 为女生记录视角，false 为男生暖心关怀视角
    status: 'normal', // during | approaching | normal
    dayInPeriod: 0,
    daysToNext: 0,
    cycleDays: 28,
    periodDays: 5,
    latestStartDate: '',
    nextStartDate: '',
    records: [],
    partnerName: 'TA',
    lastCareAt: '',

    // 打卡弹窗
    showRecordModal: false,
    recordDate: '',
    painLevel: 1,

    // 设置弹窗
    showSettingModal: false,
    editCycleDays: 28,
    editPeriodDays: 5
  },

  onLoad() {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    this.setData({ recordDate: `${yyyy}-${mm}-${dd}` })
    this.loadData()
  },

  onShow() {
    if (!this.data.loading) {
      this.loadData(false)
    }
  },

  async loadData(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await api.call('period_get', {})
      this.setData({
        loading: false,
        isFemale: res.isFemale,
        status: res.status,
        dayInPeriod: res.dayInPeriod,
        daysToNext: res.daysToNext,
        cycleDays: res.cycleDays,
        periodDays: res.periodDays,
        latestStartDate: res.latestStartDate,
        nextStartDate: res.nextStartDate,
        records: res.records || [],
        partnerName: res.partnerName || 'TA',
        editCycleDays: res.cycleDays,
        editPeriodDays: res.periodDays,
        lastCareAt: res.lastCareAt ? this.formatTime(res.lastCareAt) : ''
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载健康数据失败', icon: 'none' })
    }
  },

  formatTime(dateVal) {
    if (!dateVal) return ''
    const d = new Date(dateVal)
    if (isNaN(d.getTime())) return ''
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${m}-${day} ${h}:${min}`
  },

  // 临时手动切换男女视角查看
  togglePerspective() {
    this.setData({ isFemale: !this.data.isFemale })
    wx.vibrateShort({ type: 'light' })
  },

  // 打开记录弹窗
  openRecordModal() {
    this.setData({ showRecordModal: true })
  },

  closeRecordModal() {
    this.setData({ showRecordModal: false })
  },

  preventBubble() {},

  onRecordDateChange(e) {
    this.setData({ recordDate: e.detail.value })
  },

  selectPain(e) {
    this.setData({ painLevel: Number(e.currentTarget.dataset.val) })
  },

  // 提交经期打卡
  async submitPeriodRecord() {
    this.setData({ submitting: true })
    try {
      await api.call('period_record', {
        startDate: this.data.recordDate,
        painLevel: this.data.painLevel,
        actionType: 'start'
      })
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '记录已保存 💕', icon: 'success' })
      this.setData({ showRecordModal: false, submitting: false })
      this.loadData(false)
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  // 周期设置
  openSettingModal() {
    this.setData({ showSettingModal: true })
  },

  closeSettingModal() {
    this.setData({ showSettingModal: false })
  },

  onCycleInput(e) {
    this.setData({ editCycleDays: e.detail.value })
  },

  onPeriodInput(e) {
    this.setData({ editPeriodDays: e.detail.value })
  },

  async submitPeriodSetting() {
    const c = parseInt(this.data.editCycleDays)
    const p = parseInt(this.data.editPeriodDays)
    if (isNaN(c) || c < 15 || c > 60) {
      wx.showToast({ title: '周期天数建议在15~60天之间', icon: 'none' })
      return
    }
    if (isNaN(p) || p < 2 || p > 15) {
      wx.showToast({ title: '经期天数建议在2~15天之间', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.call('period_record', {
        actionType: 'setting',
        cycleDays: c,
        periodDays: p
      })
      wx.showToast({ title: '设置已更新', icon: 'success' })
      this.setData({ showSettingModal: false, submitting: false })
      this.loadData(false)
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '更新失败', icon: 'none' })
    }
  },

  // 男生一键送出暖心关怀
  async sendCare(e) {
    const { type, msg } = e.currentTarget.dataset
    try {
      await api.call('period_remind', { careType: type, message: msg })
      wx.vibrateShort({ type: 'heavy' })
      wx.showModal({
        title: '关怀已送达 💕',
        content: msg,
        showCancel: false,
        confirmColor: '#F48FB1',
        confirmText: '知道啦'
      })
      this.loadData(false)
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' })
    }
  }
})
