// 我：积分明细 · 互动热力图 · 冷暴力预警 · 个人设置
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')
const { formatTxTime, typeMeta, dateStr, addDays, isCloudFile } = require('../../utils/format')
const { uploadImageWithCompress } = require('../../lib/image')

const DAY_OFFSET = 84

const AVATAR_OPTIONS = ['🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄', '🐙', '🐳', '🌸', '🍀', '⭐', '🌙', '☀️', '💕', '🎀', '🎵', '🎨', '🍕', '🍔', '🍦', '🎂', '🚀', '🌈', '👤']

Page({
  data: {
    tx: [],
    txCount: 0,
    heatmap: [],
    coldWarning: false,
    activeTab: 'tx',

    // 个人设置
    editNickname: '',
    nicknameDirty: false,
    showAvatarPicker: false,
    showPrivacyModal: false,
    selectedAvatar: '',
    displayAvatar: '',
    displayAvatarImg: false,
    avatarOptions: AVATAR_OPTIONS,
    saving: false,
    me: { nickname: '', avatar: '' },
  },

  onLoad() {
    this._ucb = realtime.on('users', this.refresh.bind(this))
    this._tcb = realtime.on('transactions', this.onTx.bind(this))
  },
  onShow() { this.ensure() },
  onUnload() {
    realtime.off('users', this._ucb)
    realtime.off('transactions', this._tcb)
  },
  ensure() {
    if (!realtime.getMe()) {
      realtime.fetchOnce().then(() => {
        if (!realtime.getMe()) {
          wx.removeStorageSync('myProfile')
          wx.reLaunch({ url: '/pages/index/index' })
          return
        }
        this.refresh()
      })
    } else {
      this.refresh()
    }
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
    const curAvatar = this.data.selectedAvatar || (me ? me.avatar || '' : '')
    this.setData({
      coldWarning: realtime.checkColdWarning(),
      me: me ? { ...me } : { nickname: '', avatar: '' },
      displayAvatar: curAvatar,
      displayAvatarImg: isCloudFile(curAvatar),
      editNickname: this.data.nicknameDirty ? this.data.editNickname : (me ? me.nickname || '' : ''),
      // selectedAvatar 由 picker/save 独立管理，refresh 不覆盖，避免用户选择被重置
    })
    this.onTx()
  },
  onTx() {
    const all = realtime.getTransactions().slice()
    this.setData({
      tx: all.slice(0, 50).map(t => ({ ...t, _time: formatTxTime(t.createdAt), _meta: typeMeta(t.type) })),
      txCount: all.length,
      heatmap: this.buildHeatmap(all),
    })
  },
  buildHeatmap(transactions) {
    const today = new Date()
    const counts = {}
    transactions.forEach(t => { const key = dateStr(new Date(t.createdAt)); counts[key] = (counts[key] || 0) + 1 })
    const cells = []
    for (let i = DAY_OFFSET - 1; i >= 0; i--) {
      const d = addDays(today, -i)
      const key = dateStr(d)
      const c = counts[key] || 0
      cells.push({ key, c, level: c >= 6 ? 4 : c >= 4 ? 3 : c >= 2 ? 2 : c >= 1 ? 1 : 0 })
    }
    return cells
  },
  setTab(e) { this.setData({ activeTab: e.currentTarget.dataset.t }) },

  // -------- 个人设置 --------
  openAvatarPicker() {
    this.setData({ showAvatarPicker: true })
  },
  closeAvatarPicker() {
    this.setData({ showAvatarPicker: false })
  },
  selectAvatar(e) {
    const avatar = e.currentTarget.dataset.avatar
    this.setData({
      selectedAvatar: avatar,
      displayAvatar: avatar,
      displayAvatarImg: false,
      showAvatarPicker: false
    })
  },

  // 微信原生头像授权选择回调 (open-type="chooseAvatar")
  async onChooseAvatar(e) {
    const tempUrl = e.detail && e.detail.avatarUrl
    if (!tempUrl) return

    wx.showLoading({ title: '处理头像中...' })
    try {
      // 智能阶梯压缩并上传至云存储 avatars 目录
      const fileID = await uploadImageWithCompress(tempUrl, 'avatars')
      wx.hideLoading()
      this.setData({
        selectedAvatar: fileID,
        displayAvatar: fileID,
        displayAvatarImg: true,
        showAvatarPicker: false
      })
      wx.showToast({ title: '已选中微信头像', icon: 'none' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '上传头像失败', icon: 'none' })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
    if (field === 'editNickname') this.setData({ nicknameDirty: true })
  },

  saveProfile() {
    const { editNickname, selectedAvatar, saving, me } = this.data
    if (saving) return
    const payload = {}
    const nick = (editNickname || '').trim()
    if (nick) payload.nickname = nick
    if (selectedAvatar && selectedAvatar !== me.avatar) payload.avatar = selectedAvatar
    if (!Object.keys(payload).length) {
      return wx.showToast({ title: '没有需要修改的内容', icon: 'none' })
    }

    this.setData({ saving: true })
    api.call('updateProfile', payload)
      .then(data => {
        this.setData({ saving: false, editNickname: '', nicknameDirty: false, selectedAvatar: '' })
        wx.showToast({ title: '设置已保存', icon: 'success' })
        realtime.fetchOnce()
      })
      .catch(e => {
        this.setData({ saving: false })
        wx.showToast({ title: e.message, icon: 'none' })
      })
  },

  // 打开/关闭隐私说明弹窗（原生应用内呈现，不跳转外部网页）
  openPrivacyModal() {
    this.setData({ showPrivacyModal: true })
  },
  closePrivacyModal() {
    this.setData({ showPrivacyModal: false })
  },

  noop() {},
})
