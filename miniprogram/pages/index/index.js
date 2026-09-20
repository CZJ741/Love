// 引导页：登录后自动进入小窝（首次自动建档，或通过邀请链接加入）
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')

Page({
  data: {
    loading: true,
    error: '',
  },

  onLoad(options) {
    this._options = options || {}
    this._enter()
  },

  _enter() {
    const saved = wx.getStorageSync('myProfile')
    // 已有本地档案：直接进入家页面
    if (saved && saved.openid && saved.roomId) {
      realtime.setMyOpenid(saved.openid)
      realtime.init(saved.roomId, saved.openid)
      wx.switchTab({ url: '/pages/home/home' })
      return
    }

    // 无本地档案：通过邀请链接加入，或自动建档
    const inviteRoomId = (this._options && this._options.roomId) || ''
    const action = inviteRoomId ? 'joinViaInvite' : 'login'
    const payload = inviteRoomId ? { roomId: inviteRoomId } : {}

    this.setData({ loading: true, error: '' })
    api.call(action, payload)
      .then(data => this._saveAndGo(data))
      .catch(e => {
        console.error('autoEnter', e)
        this.setData({ loading: false, error: e.message || '进入小窝失败，请稍后再试' })
      })
  },

  retry() {
    this._enter()
  },

  // 保存档案并跳转首页
  _saveAndGo(data) {
    const me = data.me
    const save = Object.assign({}, me)
    delete save.password
    wx.setStorageSync('myProfile', save)
    realtime.setMyOpenid(me.openid)
    realtime.init(me.roomId, me.openid)
    if (data.room) realtime.seedRoom(data.room)
    if (data.roomDoc) realtime.setRoomDoc(data.roomDoc)
    wx.showToast({ title: data.msg || '进入小窝', icon: 'none' })
    setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 500)
  },
})
