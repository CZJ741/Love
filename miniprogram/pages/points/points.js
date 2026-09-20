// 任务：加分/扣分
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')
const { ADD_REASONS, DEDUCT_REASONS } = require('../../lib/constants')
const { isCloudFile } = require('../../utils/format')

Page({
  data: {
    me: { balance: 0, nickname: '', avatar: '' },
    partner: { balance: 0, nickname: 'TA', avatar: '🐰' },

    // 加分/扣分
    mode: 'add',
    amount: '',
    reason: ADD_REASONS[0],
    customReason: '',
    reasons: ADD_REASONS,
    submitting: false,

    rain: false,
  },

  onLoad() {
    this._ucb = realtime.on('users', this.refresh.bind(this))
    this._balCb = realtime.on('balances', this.onBalances.bind(this))
  },
  onShow() {
    this.ensure()
    realtime.heartbeat()
  },
  onUnload() {
    realtime.off('users', this._ucb)
    realtime.off('balances', this._balCb)
  },

  ensure() {
    realtime.fetchOnce().then(() => {
      if (!realtime.getMe()) {
        wx.removeStorageSync('myProfile')
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      this.refresh()
    }).catch(() => {
      this.refresh()
    })
  },

  onPullDownRefresh() {
    realtime.fetchOnce().then(() => {
      this.refresh()
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },

  refresh() {
    const me = realtime.getMe()
    const partner = realtime.getPartner() || this.data.partner
    this.setData({
      me: me ? { ...me, avatarImg: isCloudFile(me.avatar) } : this.data.me,
      partner: { ...partner, avatarImg: isCloudFile(partner.avatar) },
    })
  },

  // 余额快照变化（来自快速轮询，对方操作后无需刷新即可看到积分变化）
  onBalances(data) {
    if (!data) return
    const me = realtime.getMe()
    const partner = realtime.getPartner()
    if (me) me.balance = data.myBalance
    if (partner) partner.balance = data.partnerBalance
    this.refresh()
  },

  // ======== 加分 / 扣分 ========
  setMode(e) {
    const mode = e.currentTarget.dataset.m
    const reasons = mode === 'add' ? ADD_REASONS : DEDUCT_REASONS
    this.setData({ mode, reasons, reason: reasons[0], customReason: '' })
  },
  onAmountInput(e) {
    const v = e.detail.value.replace(/[^0-9]/g, '').slice(0, 2)
    this.setData({ amount: v })
  },
  onReason(e) { this.setData({ reason: e.currentTarget.dataset.r, customReason: '' }) },
  onCustom(e) { this.setData({ customReason: e.detail.value }) },

  submit() {
    const { mode, amount, reason, customReason, submitting } = this.data
    const partner = realtime.getPartner()
    if (!partner) return wx.showToast({ title: 'TA还没入住小窝哦', icon: 'none' })
    const amountNum = parseInt(amount, 10)
    if (!amountNum || amountNum <= 0) return wx.showToast({ title: '请输入有效的分数', icon: 'none' })
    if (submitting) return

    const useReason = (customReason || reason).slice(0, 100)
    this.setData({ submitting: true })
    const fn = mode === 'add' ? 'addPoints' : 'punish'

    api.call(fn, { toOpenid: partner.openid, amount: amountNum, reason: useReason })
      .then(data => {
        // 即时应用返回的余额（不等待轮询）
        const me = realtime.getMe()
        if (me) me.balance = data.myBalance
        const p = realtime.getPartner()
        if (p) p.balance = data.partnerBalance
        this.setData({ submitting: false, amount: '' })
        wx.showToast({ title: data.msg, icon: 'none' })
        if (mode === 'add') this.setData({ rain: true })
        this.refresh()
        realtime.fetchOnce()
      })
      .catch(e => {
        this.setData({ submitting: false })
        wx.showToast({ title: e.message, icon: 'none' })
      })
  },

  onRainDone() { this.setData({ rain: false }) },

  noop() {},
})
