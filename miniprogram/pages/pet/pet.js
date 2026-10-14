// 专属萌宠全屏沉浸大舞台与双人共享金币生态
const api = require('../../lib/api')
const { formatTxTime } = require('../../utils/format')
const { PET_SHOP } = require('../../lib/constants')

const NEXT_STAGE_NAMES = {
  egg: '阶段二 · 幼崽期',
  baby: '阶段三 · 成长期',
  youth: '阶段四 · 完全体',
  adult: '最高形态',
}

const SCENES = [
  { id: 'living', name: '客厅', icon: '🛋️' },
  { id: 'bedroom', name: '卧室', icon: '🛏️' },
  { id: 'bathroom', name: '浴室', icon: '🛁' },
  { id: 'outdoor', name: '室外', icon: '🌿' },
]
const SCENE_ORDER = SCENES.map(scene => scene.id)

Page({
  data: {
    // 沉浸舞台基础
    statusBarHeight: 24,
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
      coins: 100,
      todayCoins: 0,
      actionState: 'normal',
      lastActionText: '萌宠正在温暖的小窝中...',
      slots: { rug: '', bed: '', wall: '', window: '', facility: '', scene: 'living' },
      inventory: [],
      freezeUntil: 0
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
    shopList: PET_SHOP || [],
    displayShopList: PET_SHOP || [],
    dailyCoinLimit: 150,
    scenes: SCENES,
    currentScene: 'living',
    currentSceneName: '客厅',
    sceneFurniture: [],
    furnitureSceneTab: 'living',

    // 伴侣同步与动态浮条
    partnerToast: '',
    showPartnerToast: false,

    // 模态弹窗控制
    activeModal: null, // 'shop' | 'backpack' | 'decor' | 'game' | 'footprints' | 'dev'
    submitting: false,

    // 商店分类标签
    shopTab: 'consumable', // 'consumable' | 'furniture'

    // 装扮插槽分类标签
    decorSlotTab: 'rug', // 'rug' | 'bed' | 'wall' | 'window' | 'facility'

    // 小游戏引擎状态
    gameRunning: false,
    gameScore: 0,
    gameItems: [], // 掉落物
    catcherX: 50,  // 接金币小宠物横向百分比
    gameGameOver: false,
    earnedCoinsResult: null,

    // 开发者模式
    showDevModal: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sys.statusBarHeight || 24 })
    this.fetchPetData()
  },

  onShow() {
    this.fetchPetData(true)
  },

  onUnload() {
    this._stopGameLoop()
  },

  onPullDownRefresh() {
    this.fetchPetData(true).finally(() => wx.stopPullDownRefresh())
  },

  // 1. 获取最新小窝与宠物数据
  fetchPetData(quiet = false) {
    const requestId = (this._petFetchRequestId || 0) + 1
    this._petFetchRequestId = requestId
    if (!quiet) wx.showLoading({ title: '加载小窝...' })
    return api.call('petGet')
      .then(res => {
        if (!res || requestId !== this._petFetchRequestId) return
        const {
          pet,
          stageConfig,
          healthThreshold,
          canEvolve,
          isWaitingPartnerConfirm,
          isMyRequested,
          shopList,
          dailyCoinLimit
        } = res

        const oldAction = this.data.pet && this.data.pet.lastActionText
        const newAction = pet && pet.lastActionText

        const shopMap = {}
        // 商品分类和价格以当前小程序内的目录为准，避免旧版云函数返回
        // food/clean 等历史分类后，所有商品被 consumable/furniture 筛选隐藏。
        const serverShop = shopList || []
        const serverIds = new Set(serverShop.map(item => item.id))
        const localShopMap = {}
        PET_SHOP.forEach(item => { localShopMap[item.id] = item })
        const fullShop = PET_SHOP.map(item => ({
          ...item,
          ...(serverShop.find(serverItem => serverItem.id === item.id) || {}),
          available: serverIds.has(item.id)
        }))
        serverShop.forEach(item => {
          if (!localShopMap[item.id]) fullShop.push({ ...item, available: true })
        })
        fullShop.forEach(item => { shopMap[item.id] = item })

        const processedPet = pet ? {
          ...pet,
          coins: pet.coins !== undefined ? pet.coins : 100,
          inventory: (pet.inventory || []).map(inv => ({
          ...inv,
            name: (shopMap[inv.id] && shopMap[inv.id].name) || inv.id,
            emoji: (shopMap[inv.id] && shopMap[inv.id].emoji) || '🎁',
            scene: (shopMap[inv.id] && shopMap[inv.id].scene) || inv.scene || 'living'
          })),
          footprints: (pet.footprints || []).map(fp => ({
            ...fp,
            timeStr: formatTxTime(fp.time)
          }))
        } : this.data.pet

        const ownedFurnitureIds = new Set((processedPet.inventory || [])
          .filter(item => item.type === 'furniture')
          .map(item => item.id))
        const displayShopList = fullShop
          .filter(item => item.type !== 'furniture' || !ownedFurnitureIds.has(item.id))

        const equippedScene = processedPet.slots && processedPet.slots.scene
        const activeScene = SCENES.some(scene => scene.id === equippedScene) ? equippedScene : this.data.currentScene
        const sceneSlotForId = id => {
          const config = fullShop.find(shopItem => shopItem.id === id)
          return config && config.scene ? config.scene : 'living'
        }
        const sceneFurniture = Object.keys(processedPet.slots || {})
          .filter(slot => slot.startsWith('scene_'))
          .map(slot => ({ slot, id: processedPet.slots[slot] }))
          .filter(item => item.id)
          .map(item => {
            const config = fullShop.find(shopItem => shopItem.id === item.id)
            return config ? { ...config, equippedSlot: item.slot, equipped: processedPet.slots[item.slot] === item.id } : null
          })
          .filter(Boolean)

        this.setData({
          pet: processedPet,
          currentScene: activeScene,
          currentSceneName: (SCENES.find(scene => scene.id === activeScene) || SCENES[0]).name,
          furnitureSceneTab: activeScene,
          sceneFurniture,
          visibleSlots: {
            rug: sceneSlotForId(processedPet.slots && processedPet.slots.rug) === activeScene,
            bed: sceneSlotForId(processedPet.slots && processedPet.slots.bed) === activeScene,
            wall: sceneSlotForId(processedPet.slots && processedPet.slots.wall) === activeScene,
            window: sceneSlotForId(processedPet.slots && processedPet.slots.window) === activeScene,
            facility: sceneSlotForId(processedPet.slots && processedPet.slots.facility) === activeScene,
          },
          stageConfig: stageConfig || this.data.stageConfig,
          nextStageName: NEXT_STAGE_NAMES[processedPet.stage] || '',
          healthThreshold: healthThreshold || 80,
          canEvolve: Boolean(canEvolve),
          isWaitingPartnerConfirm: Boolean(isWaitingPartnerConfirm),
          isMyRequested: Boolean(isMyRequested),
          shopList: fullShop,
          displayShopList,
          dailyCoinLimit: dailyCoinLimit || 150
        })

        // 伴侣动态小浮条提示感知
        if (quiet && oldAction && newAction && oldAction !== newAction && pet.lastActionUser !== (this.data.me && this.data.me.nickname)) {
          this.triggerPartnerToast(newAction)
        }
      })
      .catch(err => {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      })
      .finally(() => {
        // onLoad 与 onShow 可能连续触发两个请求；每个显示过 loading 的请求
        // 都必须负责关闭自己的遮罩，不能因后续请求更新了序号而遗留遮罩。
        if (!quiet) wx.hideLoading()
      })
  },

  // 伴侣动态浮条自适应提示
  triggerPartnerToast(text) {
    if (!text) return
    const readableText = /为小窝插槽换上了|[銆€鎹负]/u.test(text)
      ? '小窝刚刚换上了新装饰！'
      : text
    this.setData({ partnerToast: readableText, showPartnerToast: true })
    if (this._toastTimer) clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => {
      this.setData({ showPartnerToast: false })
    }, 3200)
  },

  // 2. 点击场景内的宠物触发 Live2D 动作
  onTapPet() {
    try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
    const petComp = this.selectComponent('#live2d-stage-pet')
    if (petComp && petComp.onTapPet) {
      petComp.onTapPet()
    }
  },

  // 接收 Live2D 内部向外冒泡的抚摸事件
  onPetLive2DInteract(e) {
    const action = (e.detail && e.detail.action) || 'touch'
    this.doQuickInteract(action)
  },

  // 触发快速轻量互动抚摸
  doQuickInteract(petAction = 'touch') {
    if (this.data.submitting) return
    this.setData({ submitting: true })

    api.call('petInteract', { petAction })
      .then(res => {
        if (res && res.replyText) {
          wx.showToast({ title: res.replyText, icon: 'none' })
        }
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.showToast({ title: err.message || '互动失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 3. 打开/关闭各悬浮功能弹层
  openModal(e) {
    const type = e.currentTarget.dataset.type
    try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
    this.setData({ activeModal: type })
    if (type === 'game') {
      this.initMiniGame()
    }
  },

  closeModal() {
    this._stopGameLoop()
    this.setData({ activeModal: null, gameRunning: false })
  },

  switchShopTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ shopTab: tab, furnitureSceneTab: this.data.currentScene })
  },

  switchDecorTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ decorSlotTab: tab, furnitureSceneTab: this.data.currentScene })
  },

  switchScene(e) {
    const scene = e.currentTarget.dataset.scene
    if (!SCENES.some(item => item.id === scene)) return
    const slots = { ...(this.data.pet.slots || {}), scene }
    const findScene = id => {
      const config = this.data.shopList.find(item => item.id === id)
      return config && config.scene ? config.scene : 'living'
    }
    this.setData({
      currentScene: scene,
      currentSceneName: (SCENES.find(item => item.id === scene) || SCENES[0]).name,
      furnitureSceneTab: scene,
      'pet.slots': slots,
      visibleSlots: {
        rug: findScene(slots.rug) === scene,
        bed: findScene(slots.bed) === scene,
        wall: findScene(slots.wall) === scene,
        window: findScene(slots.window) === scene,
        facility: findScene(slots.facility) === scene,
      }
    })
    api.call('petEquipSlot', { slot: 'scene', itemId: scene })
      .then(() => this.fetchPetData(true))
      .catch(err => wx.showToast({ title: err.message || '场景保存失败', icon: 'none' }))
  },

  previousScene() {
    const index = SCENE_ORDER.indexOf(this.data.currentScene)
    const scene = SCENE_ORDER[(index - 1 + SCENE_ORDER.length) % SCENE_ORDER.length]
    this.switchScene({ currentTarget: { dataset: { scene } } })
  },

  nextScene() {
    const index = SCENE_ORDER.indexOf(this.data.currentScene)
    const scene = SCENE_ORDER[(index + 1) % SCENE_ORDER.length]
    this.switchScene({ currentTarget: { dataset: { scene } } })
  },

  switchFurnitureScene(e) {
    const scene = e.currentTarget.dataset.scene
    if (!SCENES.some(item => item.id === scene)) return
    this.setData({ furnitureSceneTab: scene })
  },

  equipSceneFurniture(e) {
    const { id, scene, slot } = e.currentTarget.dataset
    if (!id || !scene || !slot || this.data.submitting) return
    const legacySlot = ['rug', 'bed', 'wall', 'window', 'facility'].includes(slot) ? slot : 'facility'
    const sceneSlot = `scene_${scene}_${slot}`
    this.setData({ submitting: true })
    api.call('petEquipSlot', { slot: sceneSlot, itemId: id })
      .catch(err => {
        if (/无效的家具插槽/.test(err.message || '')) {
          return api.call('petEquipSlot', { slot: legacySlot, itemId: id })
        }
        throw err
      })
      .then(() => this.fetchPetData(true))
      .catch(err => wx.showToast({ title: err.message || '装饰失败', icon: 'none' }))
      .finally(() => this.setData({ submitting: false }))
  },

  // 4. 萌宠商店：消耗共享金币购买道具/家具
  buyShopItem(e) {
    const itemId = e.currentTarget.dataset.id
    const item = this.data.shopList.find(shopItem => shopItem.id === itemId)
    if (!item || this.data.submitting) return
    if (item.available === false || e.currentTarget.dataset.available === false) {
      return wx.showToast({ title: '该家具尚未上架，请先更新云函数', icon: 'none' })
    }
    const coins = (this.data.pet && this.data.pet.coins) || 0

    if (coins < item.price) {
      return wx.showToast({ title: '金币不足，快去玩游戏赚金币吧~', icon: 'none' })
    }

    wx.showModal({
      title: `购买【${item.name}】`,
      content: `确认消耗 ${item.price} 萌宠金币吗？\n（当前共享金币: ${coins}）`,
      confirmText: '确认购买',
      confirmColor: '#FFA726',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '购买中...' })
          this.setData({ submitting: true })

          api.call('petBuyItem', { itemId: item.id })
            .then(buyRes => {
              wx.hideLoading()
              try { wx.vibrateShort({ type: 'medium' }) } catch (_) {}
              wx.showToast({ title: buyRes.replyText || '已放入储物箱！', icon: 'none' })
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

  // 5. 储物箱背包：使用消耗品
  useBackpackItem(e) {
    const itemId = e.currentTarget.dataset.id
    if (!itemId || this.data.submitting) return

    wx.showLoading({ title: '使用中...' })
    this.setData({ submitting: true })

    api.call('petUseItem', { itemId })
      .then(res => {
        wx.hideLoading()
        try { wx.vibrateShort({ type: 'medium' }) } catch (_) {}
        wx.showToast({ title: res.replyText || '使用成功！', icon: 'none' })
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '使用失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 6. 装扮小窝：插槽家具更换/穿戴/卸下
  equipFurniture(e) {
    const { slot, id } = e.currentTarget.dataset
    if (!slot || this.data.submitting) return

    wx.showLoading({ title: '装扮更换中...' })
    this.setData({ submitting: true })

    api.call('petEquipSlot', { slot, itemId: id || '' })
      .then(res => {
        wx.hideLoading()
        try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
        wx.showToast({ title: id ? '装扮已换上！' : '已卸下装扮', icon: 'success' })
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '更换失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 7. 第三人称操控萌宠小游戏引擎（萌宠接金币躲炸弹）
  initMiniGame() {
    this.setData({
      gameRunning: false,
      gameScore: 0,
      gameItems: [],
      catcherX: 50,
      gameGameOver: false,
      earnedCoinsResult: null
    })
  },

  startMiniGame() {
    const energy = (this.data.pet && this.data.pet.energy) || 0
    if (energy < 10) {
      return wx.showToast({ title: '小萌宠体力过低，让它在小窝歇一歇吧~', icon: 'none' })
    }

    this.setData({
      gameRunning: true,
      gameScore: 0,
      gameItems: [],
      catcherX: 50,
      gameGameOver: false,
      earnedCoinsResult: null
    })

    this._gameTick = 0
    this._runGameLoop()
  },

  // 触控移动下方宠物接收器
  onGameTouchMove(e) {
    if (!this.data.gameRunning || this.data.gameGameOver) return
    const touch = e.touches[0]
    if (!touch) return
    const sys = wx.getSystemInfoSync()
    const screenWidth = sys.windowWidth || 375
    let pct = (touch.clientX / screenWidth) * 100
    pct = Math.max(10, Math.min(90, pct))
    this.setData({ catcherX: pct })
  },

  _runGameLoop() {
    this._stopGameLoop()
    this._gameInterval = setInterval(() => {
      if (!this.data.gameRunning || this.data.gameGameOver) return

      this._gameTick = (this._gameTick || 0) + 1
      let { gameItems, gameScore, catcherX } = this.data
      const updatedItems = []

      // 周期性生成新的金币/星星/小鱼干/恶作剧障碍
      if (this._gameTick % 6 === 0) {
        const types = [
          { type: 'coin', emoji: '🪙', pts: 10 },
          { type: 'coin', emoji: '🪙', pts: 10 },
          { type: 'star', emoji: '⭐', pts: 15 },
          { type: 'fish', emoji: '🐟', pts: 20 },
          { type: 'bomb', emoji: '💣', pts: -25 }
        ]
        const pick = types[Math.floor(Math.random() * types.length)]
        updatedItems.push({
          id: Math.random(),
          x: Math.random() * 80 + 10,
          y: 0,
          speed: Math.random() * 2 + 3,
          emoji: pick.emoji,
          type: pick.type,
          pts: pick.pts
        })
      }

      // 物理下落与碰撞检测
      for (const item of gameItems) {
        item.y += item.speed
        // 判断是否落在宠物接取高度 (y 在 78% ~ 88% 之间)
        if (item.y >= 78 && item.y <= 88) {
          if (Math.abs(item.x - catcherX) < 14) {
            // 接中碰撞
            gameScore = Math.max(0, gameScore + item.pts)
            try { wx.vibrateShort({ type: 'light' }) } catch (_) {}
            continue
          }
        }
        if (item.y < 95) {
          updatedItems.push(item)
        }
      }

      this.setData({ gameItems: updatedItems, gameScore })

      // 达到特定时长或分数完成结算
      if (this._gameTick >= 120) {
        this.finishMiniGame()
      }
    }, 100)
  },

  _stopGameLoop() {
    if (this._gameInterval) {
      clearInterval(this._gameInterval)
      this._gameInterval = null
    }
  },

  // 小游戏局末结算
  finishMiniGame() {
    this._stopGameLoop()
    this.setData({ gameGameOver: true, gameRunning: false })

    wx.showLoading({ title: '金币结算中...' })
    api.call('petGameFinish', { score: this.data.gameScore, gameType: 'catcher' })
      .then(res => {
        wx.hideLoading()
        this.setData({ earnedCoinsResult: res })
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '结算失败', icon: 'none' })
      })
  },

  // 8. 进化申请与见证确认
  requestEvolve() {
    wx.showModal({
      title: '发起进化仪式',
      content: '确认发起蜕变升级？将邀请 TA 一同共同见证破茧蜕变瞬间！',
      confirmText: '发起见证',
      confirmColor: '#FF4081',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '发起中...' })
          api.call('petRequestEvolve')
            .then(r => {
              wx.hideLoading()
              wx.showToast({ title: r.msg || '已发起！', icon: 'none' })
              this.fetchPetData(true)
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '发起失败', icon: 'none' })
            })
        }
      }
    })
  },

  confirmEvolve() {
    wx.showModal({
      title: '见证蜕变时刻！',
      content: 'TA 已发起进化申请，确认一同见证小萌宠的进阶蜕变吗？',
      confirmText: '立即见证',
      confirmColor: '#E91E63',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '蜕变中...' })
          api.call('petConfirmEvolve')
            .then(r => {
              wx.hideLoading()
              wx.showModal({
                title: '进阶成功！🎉',
                content: r.msg || '恭喜萌宠破茧蜕变！全属性已恢复满格！',
                showCancel: false
              })
              this.fetchPetData(true)
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '确认失败', icon: 'none' })
            })
        }
      }
    })
  },

  // 9. 宠物改名
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
  },

  // 10. 开发者调试测试面板
  toggleDevModal() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    this.setData({ showDevModal: !this.data.showDevModal })
  },

  devSwitchStage(e) {
    const stage = e.currentTarget.dataset.stage
    this._callDevSet({ stage, exp: 0 })
  },

  devAddCoins() {
    this._callDevSet({ coinsDelta: 500 })
  },

  devMakeSick() {
    this._callDevSet({ health: 40, actionState: 'sick' })
  },

  devMakeHungry() {
    this._callDevSet({ hunger: 20, actionState: 'sad' })
  },

  devMaxExp() {
    const maxExp = (this.data.stageConfig && this.data.stageConfig.maxExp) || 100
    this._callDevSet({ exp: maxExp, health: 95, actionState: 'happy' })
  },

  devFullRecovery() {
    this._callDevSet({ health: 100, hunger: 100, mood: 100, cleanliness: 100, energy: 100, actionState: 'happy' })
  },

  _callDevSet(params) {
    wx.showLoading({ title: '调试中...' })
    api.call('petDevSet', params)
      .then(res => {
        wx.hideLoading()
        wx.showToast({ title: '已生效', icon: 'success' })
        if (res) {
          this.setData({
            pet: {
              ...this.data.pet,
              ...res,
              coins: res.coins !== undefined ? res.coins : (this.data.pet && this.data.pet.coins) || 0
            }
          })
        }
        this.fetchPetData(true)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '设置失败', icon: 'none' })
      })
  },

  // 11. 返回上级
  navigateBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/home/home' })
      }
    })
  },

  noop() {}
})
