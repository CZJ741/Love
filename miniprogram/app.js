// app.js —— 子&然 小窝
const api = require('./lib/api')
const realtime = require('./lib/realtime')
const config = require('./lib/config')

App({
  globalData: {
    myOpenid: '',
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    // 注册隐私接口授权处理（微信 2023 隐私政策要求）
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization(resolve => {
        wx.showModal({
          title: '隐私授权说明',
          content: '子&然 小窝 需要访问你的相册，用于在日记中上传照片。我们不会收集或分享你的个人隐私信息。',
          confirmText: '同意',
          cancelText: '拒绝',
          success: res => {
            if (res.confirm) {
              resolve({ event: 'agree', buttonIndex: 0 })
            } else {
              resolve({ event: 'disagree', buttonIndex: 1 })
            }
          },
        })
      })
    }
    const initOpts = { traceUser: true }
    if (config.envId) initOpts.env = config.envId
    wx.cloud.init(initOpts)

    // 关键：先从缓存立即初始化 realtime（设置 roomId/openid，启动 watch 与 fetchOnce），
    // 不等 login 云函数返回。否则页面 onLoad/onShow 时 roomId 仍为空，fetchOnce 直接跳过。
    const saved = wx.getStorageSync('myProfile')
    if (saved && saved.openid && saved.roomId) {
      this.globalData.myOpenid = saved.openid
      // 立即启动实时数据层（不等待 login 异步结果）
      realtime.init(saved.roomId, saved.openid)
      console.log('[app] realtime.init done, roomId:', saved.roomId)

      // 有档案则直接进入家页面，跳过引导页
      wx.switchTab({ url: '/pages/home/home' })

      // login 云函数用于刷新档案、自动建集合、播种房间成员（补充性质，失败也不影响页面使用）
      api.call('login', { roomId: saved.roomId })
        .then(data => {
          if (data && data.me) {
            const save = Object.assign({}, data.me)
            delete save.password
            wx.setStorageSync('myProfile', save)
            realtime.seedRoom(data.room)
            if (data.roomDoc) realtime.setRoomDoc(data.roomDoc)
          }
        })
        .catch(e => {
          console.error('app.bootstrap login', e)
          if (e && e.message && e.message.indexOf('请填写') >= 0) {
            wx.removeStorageSync('myProfile')
            wx.reLaunch({ url: '/pages/index/index' })
          }
        })
    }
  },

  onShow() {
    // 小程序切回前台：恢复长连接并拉取最新快照
    realtime.resumeWatches()
  },

  onHide() {
    // 小程序切到后台：休眠实时监听，停止持续消耗配额与流量
    realtime.pauseWatches()
  },
})
