// 专属萌宠纯成长进化体系与积分商城页面逻辑
const api = require('../../lib/api')

const NEXT_STAGE_NAMES = {
  egg: '阶段二 · 幼崽期',
  baby: '阶段三 · 成长期',
  youth: '阶段四 · 完全体',
  adult: '最高形态',
}

Page({
  data: {
    pet: {
      name: '小糯米',
      stage: 'egg',
      hunger: 90,
      mood: 90,
      cleanliness: 90,
      energy: 90,
      health: 95,
      exp: 0,
      maxExp: 100,
      todayExp: 0,
      actionState: 'normal',
      lastActionText: '小生命正在温暖的蛋壳中孕育...',
    },
    stageConfig: {
      key: 'egg',
      name: '萌宠蛋',
      dailyExpLimit: 40,
      maxExp: 100,
      nextStage: 'baby'
    },
    nextStageName: '阶段二 · 幼崽期',
    healthThreshold: 80,
    canEvolve: false,
    isWaitingPartnerConfirm: false,
    isMyRequested: false,
    shopList: [],
    myBalance: 0,
    speechText: '轻触蛋壳抚摸对话，孵化经验由双方共同积累~',
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
        if (!res) return
        const {
          pet,
          stageConfig,
          healthThreshold,
          canEvolve,
          isWaitingPartnerConfirm,
          isMyRequested,
          shopList,
          myBalance
        } = res

        this.setData({
          pet: pet || this.data.pet,
          stageConfig: stageConfig || this.data.stageConfig,
          nextStageName: NEXT_STAGE_NAMES[pet.stage] || '',
          healthThreshold: healthThreshold || 80,
          canEvolve: Boolean(canEvolve),
          isWaitingPartnerConfirm: Boolean(isWaitingPartnerConfirm),
          isMyRequested: Boolean(isMyRequested),
          shopList: shopList || [],
          myBalance: myBalance || 0,
          speechText: this._getSpeechByPet(pet)
        })
      })
      .catch(err => {
        wx.showToast({ title: err.message || '获取数据失败', icon: 'none' })
      })
      .finally(() => {
        if (!quiet) wx.hideLoading()
      })
  },

  _getSpeechByPet(pet) {
    if (!pet) return '今天也是元气满满的一天！'
    if (pet.stage === 'egg') {
      if (pet.exp >= pet.maxExp) return '蛋壳微微晃动发光，已经具备孵化蜕变幼崽的条件啦！'
      return '蛋壳暖洋洋的，轻触对话让小生命感受到爱意~'
    }
    if (pet.health < 60) return '呜呜... 脑袋昏昏沉沉生病了，需要看病吃药或洗香香才能恢复健康！'
    if (pet.hunger < 35) return '肚子好饿呀，快去宠物商城买点好吃的肉干吧！'
    if (pet.mood < 35) return '委屈巴巴... 摸摸我或者陪我玩飞盘好不好？'
    if (pet.cleanliness < 40) return '身上脏兮兮的，想要舒舒服服洗个泡泡澡！'
    if (pet.energy < 20) return '好困好累呀，抱我去小被子里睡个大觉吧 zZ'
    if (pet.exp >= pet.maxExp && pet.health >= 80) return '🌟 能量已蓄满！快和 TA 一起发起进化仪式吧！'
    return '摇尾巴！肚皮饱饱身体棒，最喜欢和你们在一起啦！'
  },

  // 接收 Live2D 组件触碰互动事件
  onPetInteract(e) {
    const action = (e.detail && e.detail.action) || 'touch'
    this.doInteractAction(action)
  },

  // 触发常规日常照料（摸摸/对话/摇晃/洗澡/睡眠/看病）
  doInteract(e) {
    const act = e.currentTarget.dataset.act
    if (!act) return
    this.doInteractAction(act)
  },

  doInteractAction(act) {
    if (this.data.submitting) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    this.setData({ submitting: true })

    api.call('petInteract', { action: act })
      .then(res => {
        if (res && res.pet) {
          this.setData({
            pet: res.pet,
            speechText: res.replyText || this._getSpeechByPet(res.pet)
          })
        }
        if (res && res.replyText) {
          wx.showToast({ title: res.replyText, icon: 'none', duration: 2500 })
        }
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 购买并使用宠物积分商城道具
  buyShopItem(e) {
    const item = e.currentTarget.dataset.item
    if (!item || this.data.submitting) return

    wx.showModal({
      title: `购买 ${item.name}`,
      content: `确认消耗 ${item.price} 积分购买并喂养宠物吗？\n（当前积分余额: ${this.data.myBalance}）`,
      confirmText: '购买使用',
      confirmColor: '#FB8C00',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '购买喂养中...' })
          this.setData({ submitting: true })

          api.call('petBuyItem', { itemId: item.id })
            .then(buyRes => {
              wx.hideLoading()
              try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
              if (buyRes && buyRes.replyText) {
                wx.showToast({ title: buyRes.replyText, icon: 'none', duration: 2500 })
              }
              this.fetchPetData(true)
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '购买失败', icon: 'none' })
            })
            .finally(() => {
              this.setData({ submitting: false })
            })
        }
      }
    })
  },

  // 发起阶段进化申请
  requestEvolve() {
    if (this.data.submitting) return
    wx.showModal({
      title: '发起阶段进化仪式',
      content: `经验已满且健康度达标（${this.data.pet.health}%）！发起后将邀请 TA 共同见证蜕变。是否发起？`,
      confirmText: '发起见证',
      confirmColor: '#E91E63',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '发起中...' })
          this.setData({ submitting: true })
          api.call('petRequestEvolve')
            .then(res => {
              wx.hideLoading()
              wx.showToast({ title: res.msg || '已发起！等待TA确认', icon: 'none', duration: 3000 })
              this.fetchPetData(true)
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '发起失败', icon: 'none' })
            })
            .finally(() => {
              this.setData({ submitting: false })
            })
        }
      }
    })
  },

  // 对方确认进化完成蜕变
  confirmEvolve() {
    if (this.data.submitting) return
    wx.showModal({
      title: '共同见证破茧进化',
      content: `TA 已经发起了进化仪式！点击确认即可完成蜕变，双方宠物全部属性重置为 100 满格奖励！`,
      confirmText: '共同见证！',
      confirmColor: '#E91E63',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '见证蜕变中...' })
          this.setData({ submitting: true })
          api.call('petConfirmEvolve')
            .then(res => {
              wx.hideLoading()
              try { wx.vibrateLong() } catch (err) {}
              wx.showModal({
                title: '进化成功！🎉',
                content: res.congratulationText || '恭喜萌宠破茧蜕变！全属性已恢复满格！',
                showCancel: false
              })
              this.fetchPetData(true)
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '确认失败', icon: 'none' })
            })
            .finally(() => {
              this.setData({ submitting: false })
            })
        }
      }
    })
  },

  // 修改昵称
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
