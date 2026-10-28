// 情侣记账 / AA神器 页面交互逻辑
const api = require('../../lib/api')

Page({
  data: {
    loading: true,
    submitting: false,
    currentMonth: '',
    summary: {
      debtStatus: 'even', // even | partner_owes_me | i_owe_partner
      netDueToMeYuan: '0.00',
      monthTotalExpenseYuan: '0.00',
      myMonthPaidYuan: '0.00',
      partnerMonthPaidYuan: '0.00',
      commonMonthExpenseYuan: '0.00',
      partnerName: 'TA',
      myName: '我'
    },
    bills: [],
    showAddModal: false,
    form: {
      amount: '',
      category: 'dining',
      payerType: 'user',
      whoPaid: 'me',
      splitRule: 'aa',
      remark: '',
      billDate: ''
    }
  },

  onLoad() {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const currentMonth = `${yyyy}-${mm}`
    const today = `${yyyy}-${mm}-${dd}`

    this.setData({
      currentMonth,
      'form.billDate': today
    })

    this.loadData()
  },

  onShow() {
    if (!this.data.loading) {
      this.loadData(false)
    }
  },

  // 加载账单与对账汇总
  async loadData(showLoadingIndicator = true) {
    if (showLoadingIndicator) {
      this.setData({ loading: true })
    }
    try {
      const res = await api.call('billing_get', { month: this.data.currentMonth })
      this.setData({
        loading: false,
        summary: {
          debtStatus: res.debtStatus,
          netDueToMeYuan: res.netDueToMeYuan,
          monthTotalExpenseYuan: res.monthTotalExpenseYuan,
          myMonthPaidYuan: res.myMonthPaidYuan,
          partnerMonthPaidYuan: res.partnerMonthPaidYuan,
          commonMonthExpenseYuan: res.commonMonthExpenseYuan,
          partnerName: res.partnerName || 'TA',
          myName: res.myName || '我'
        },
        bills: res.bills || []
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载账单失败', icon: 'none' })
    }
  },

  // 切换月份
  onMonthChange(e) {
    const newMonth = e.detail.value
    this.setData({ currentMonth: newMonth }, () => {
      this.loadData()
    })
  },

  // 打开记账弹窗
  openAddModal() {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const today = `${yyyy}-${mm}-${dd}`

    this.setData({
      showAddModal: true,
      form: {
        amount: '',
        category: 'dining',
        payerType: 'user',
        whoPaid: 'me',
        splitRule: 'aa',
        remark: '',
        billDate: today
      }
    })
    wx.vibrateShort({ type: 'light' })
  },

  closeAddModal() {
    this.setData({ showAddModal: false })
  },

  preventBubble() {},

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value })
  },

  selectCategory(e) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ 'form.category': cat })
    wx.vibrateShort({ type: 'light' })
  },

  selectPayer(e) {
    const { type, who } = e.currentTarget.dataset
    this.setData({
      'form.payerType': type,
      'form.whoPaid': who
    })
    wx.vibrateShort({ type: 'light' })
  },

  selectSplit(e) {
    const rule = e.currentTarget.dataset.rule
    this.setData({ 'form.splitRule': rule })
    wx.vibrateShort({ type: 'light' })
  },

  onDateChange(e) {
    this.setData({ 'form.billDate': e.detail.value })
  },

  onRemarkInput(e) {
    this.setData({ 'form.remark': e.detail.value })
  },

  // 提交新账单
  async submitBill() {
    const { amount, category, payerType, whoPaid, splitRule, remark, billDate } = this.data.form
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) {
      wx.showToast({ title: '请输入正确金额', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await api.call('billing_add', {
        amount: num,
        category,
        payerType,
        whoPaid,
        splitRule,
        remark: (remark || '').trim(),
        billDate
      })
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '记录成功', icon: 'success' })
      this.setData({ showAddModal: false, submitting: false })
      this.loadData(false)
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '记账失败', icon: 'none' })
    }
  },

  // 删除账单
  onDeleteBill(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这笔账单记录吗？',
      confirmColor: '#FF5252',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.call('billing_delete', { id })
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadData(false)
          } catch (err) {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 一键对齐结清
  onSettleTap() {
    const { debtStatus, netDueToMeYuan, partnerName } = this.data.summary
    if (debtStatus === 'even') {
      wx.showToast({ title: '双方已两清', icon: 'none' })
      return
    }

    const tip = debtStatus === 'partner_owes_me'
      ? `确认收到 ${partnerName} 的补款 ¥${netDueToMeYuan} 并对齐结清吗？`
      : `确认已给 ${partnerName} 补齐差额 ¥${netDueToMeYuan} 并对齐结清吗？`

    wx.showModal({
      title: '对齐结清',
      content: tip,
      confirmText: '确认结清',
      confirmColor: '#F48FB1',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.call('billing_settle', {})
            wx.vibrateShort({ type: 'medium' })
            wx.showToast({ title: '已对齐两清', icon: 'success' })
            this.loadData(false)
          } catch (err) {
            wx.showToast({ title: err.message || '结清失败', icon: 'none' })
          }
        }
      }
    })
  }
})
