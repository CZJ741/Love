// 专属萌宠爱心小窝页面逻辑
const api = require('../../lib/api')

Page({
  data: {
    pet: {
      name: '小糯米',
      hunger: 80,
      mood: 85,
      energy: 90,
      level: 1,
      exp: 0,
      actionState: 'normal',
      lastActionText: '小狗正安稳待在小窝中',
    },
    speechText: '汪！主人你来啦，小狗正在开心地摇尾巴！',
    submitting: false,
  },

  onLoad() {
    this.fetchPetData()
  },

  onShow() {
    this.fetchPetData(true)
  },

  onPullDownRefresh() {
    this.fetchPetData(true).finally(() => wx.stopPullDownRefresh())
  },

  fetchPetData(quiet = false) {
    if (!quiet) wx.showLoading({ title: '加载中...' })
    return api.call('petGet')
      .then(res => {
        if (res && res.pet) {
          this.setData({
            pet: res.pet,
            speechText: this._getSpeechByPet(res.pet)
          })
        }
      })
      .catch(err => {
        wx.showToast({ title: err.message || '获取数据失败', icon: 'none' })
      })
      .finally(() => {
        if (!quiet) wx.hideLoading()
      })
  },

  _getSpeechByPet(pet) {
    if (!pet) return '汪！今天也是元气满满的一天！'
    if (pet.hunger < 30) return '呜呜... 肚子好饿好饿，想吃香喷喷的肉干！'
    if (pet.mood < 30) return '委屈巴巴... 是不是忙起来把我忘记啦？'
    if (pet.energy < 20) return '呼噜噜... 脑袋晕乎乎的，想要抱抱睡大觉 zZ'
    if (pet.hunger > 80 && pet.mood > 80) return '摇尾巴！肚皮饱饱，心情棒棒，最爱你们啦~'
    return '汪！随时都在小窝陪伴你们，今天也超级想你！'
  },

  // 接收 Live2D 组件触碰互动事件
  onPetInteract(e) {
    const action = (e.detail && e.detail.action) || 'poke'
    const quotes = [
      '嗷呜~ 被摸得舒服极啦，小尾巴摇成直升机！',
      '扑进你的怀抱里！最喜欢主人摸摸脑袋啦~',
      '歪头看着你：今天你们有想对方吗？',
      '汪！是不是要带我去吃好吃的呀？'
    ]
    const pick = quotes[Math.floor(Math.random() * quotes.length)]
    this.setData({ speechText: pick })

    api.call('petInteract', { action })
      .then(res => {
        if (res && res.pet) {
          this.setData({ pet: res.pet })
        }
      })
      .catch(() => {})
  },

  // 触发养成互动（喂食、抚摸、玩耍、送礼、睡眠）
  doInteract(e) {
    const act = e.currentTarget.dataset.act
    if (!act || this.data.submitting) return

    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    this.setData({ submitting: true })
    wx.showLoading({ title: '互动中...' })

    api.call('petInteract', { action: act })
      .then(res => {
        wx.hideLoading()
        if (res && res.pet) {
          this.setData({
            pet: res.pet,
            speechText: res.replyText || this._getSpeechByPet(res.pet)
          })
        }
        if (res && res.replyText) {
          wx.showToast({ title: res.replyText, icon: 'none', duration: 2500 })
        }
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 修改宠物昵称
  promptRename() {
    wx.showModal({
      title: '给萌宠起个名字',
      editable: true,
      placeholderText: this.data.pet.name || '小糯米',
      success: res => {
        if (res.confirm && res.content) {
          const name = res.content.trim()
          if (!name) return
          wx.showLoading({ title: '修改中...' })
          api.call('petRename', { name })
            .then(() => {
              wx.hideLoading()
              this.fetchPetData(true)
              wx.showToast({ title: `名字已改为【${name}】`, icon: 'success' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '修改失败', icon: 'none' })
            })
        }
      }
    })
  }
})
