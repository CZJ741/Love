// Live2D 唯美可爱小狗双人桌宠组件逻辑
Component({
  properties: {
    compactMode: {
      type: Boolean,
      value: false,
    },
    pet: {
      type: Object,
      value: {
        name: '小糯米',
        stage: 'egg',
        hunger: 80,
        mood: 85,
        energy: 90,
        health: 95,
        level: 1,
        exp: 0,
        actionState: 'normal',
      },
      observer(newVal) {
        if (!newVal || !this._isReady) return
        const toSet = {}
        const state = newVal.actionState || 'normal'
        if (state !== this.data.actionState) {
          toSet.actionState = state
          this._updateEmotionEffects(state)
        }
        if (newVal.stage) {
          const names = { egg: '萌宠蛋', baby: '幼崽期', youth: '成长期', adult: '完全体' }
          const sName = names[newVal.stage] || '幼崽期'
          if (sName !== this.data.stageName) {
            toSet.stageName = sName
          }
        }
        if (Object.keys(toSet).length > 0) {
          this.setData(toSet)
        }
      }
    }
  },

  data: {
    stageName: '萌宠蛋',
    actionState: 'normal', // happy | sad | surprise | normal | expectant | sleepy | sick
    idleIndex: 0, // 0: 安静呼吸, 1: 好奇歪头, 2: 开心摇尾
    isBlinking: false,
    isTapped: false,

    bubbleText: '',
    bubbleAnim: false,

    showHeartFx: false,
    showSweatFx: false,
    showZzzFx: false,
    showBubbleFx: false,
    showFoodFx: false,
  },

  pageLifetimes: {
    show() {
      if (!this._isReady) return
      this._resetAnimationState()
      this._startIdleActionLoop()
      this._startBlinkLoop()
    },
    hide() {
      this._clearAllTimers()
    },
  },

  lifetimes: {
    ready() {
      // 在 DOM 树与首屏渲染完全确立后，再开启 observer 与动效循环，杜绝 FLOW_INITIAL_CREATION 报错
      this._isReady = true
      if (this.data.pet) {
        const pet = this.data.pet
        const names = { egg: '萌宠蛋', baby: '幼崽期', youth: '成长期', adult: '完全体' }
        this.setData({
          actionState: pet.actionState || 'normal',
          stageName: names[pet.stage] || '萌宠蛋'
        })
        this._updateEmotionEffects(pet.actionState || 'normal')
      }
      this._startIdleActionLoop()
      this._startBlinkLoop()
    },
    detached() {
      this._isReady = false
      this._clearAllTimers()
    }
  },

  methods: {
    _scheduleFx(callback, delay) {
      if (!this._fxTimers) this._fxTimers = new Set()
      const timer = setTimeout(() => {
        this._fxTimers.delete(timer)
        if (this._isReady) callback()
      }, delay)
      this._fxTimers.add(timer)
      return timer
    },

    _resetAnimationState() {
      const state = (this.data.pet && this.data.pet.actionState) || 'normal'
      this._lastTapTime = 0
      this.setData({ idleIndex: 0, isBlinking: false, isTapped: false,
        bubbleText: '', bubbleAnim: false, actionState: state })
      this._updateEmotionEffects(state)
    },

    // 1. 三套自然循环待机动作：呼吸 → 歪头 → 摇尾
    _startIdleActionLoop() {
      if (this._idleTimer) clearInterval(this._idleTimer)
      this._idleTimer = setInterval(() => {
        // 互动或照料中的情绪由 actionState 接管，避免待机动作抢占表情。
        const pet = this.data.pet || {}
        if ((this.data.actionState === 'normal' || this.data.actionState === 'expectant') &&
          pet.stage !== 'egg' && pet.health >= 60 && !this.data.isTapped) {
          const nextIdle = (this.data.idleIndex + 1) % 3
          this.setData({ idleIndex: nextIdle })
        }
      }, 4000)
    },

    // 2. 真实拟真眨眼循环
    _startBlinkLoop() {
      if (this._blinkTimer) clearInterval(this._blinkTimer)
      this._blinkTimer = setInterval(() => {
        if (this.data.actionState !== 'happy' && this.data.actionState !== 'sleepy') {
          this.setData({ isBlinking: true })
          this._blinkResetTimer = this._scheduleFx(() => this.setData({ isBlinking: false }), 150)
        }
      }, 4500)
    },

    // 3. 进入页面时的初次打招呼
    _greetOnLoad() {
      const pet = this.data.pet || {}
      const hour = new Date().getHours()
      let greet = '汪！今天也超级想你们呢~'
      if (hour >= 23 || hour < 6) {
        greet = '呼噜呼噜... 已经很晚啦，快睡吧 zZ'
      } else if (hour >= 6 && hour < 9) {
        greet = '早安主人！小狗摇着尾巴向你问好~'
      } else if (pet.hunger < 40) {
        greet = '呜呜... 小狗肚子咕咕叫了，求投喂肉干~'
      } else if (pet.mood > 85) {
        greet = '摇尾巴！今天也是元气满满的一天！'
      }

      this.showBubble(greet, 3500)
    },

    // 4. 显示气泡对白
    showBubble(text, duration = 3000) {
      if (this._bubbleTimer) clearTimeout(this._bubbleTimer)
      this.setData({
        bubbleText: text,
        bubbleAnim: true
      })
      this._bubbleTimer = setTimeout(() => {
        this.setData({ bubbleText: '', bubbleAnim: false })
      }, duration)
    },

    // 5. 点击小狗（支持双击判定）
    onPetTap() {
      const now = Date.now()
      if (this._lastTapTime && (now - this._lastTapTime < 350)) {
        // 触发双击事件，直接进入全屏专属宠物页面
        this._lastTapTime = 0
        try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
        this.triggerEvent('doubletap', {})
        return
      }
      this._lastTapTime = now

      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}

      // 触发弹跳与爱心动效
      this.setData({
        isTapped: true,
        showHeartFx: true,
        actionState: 'expectant'
      })

      this._scheduleFx(() => this.setData({ isTapped: false }), 400)
      this._scheduleFx(() => this.setData({ showHeartFx: false }), 1200)

      const quotes = [
        '嗷呜~ 被摸得舒服极啦，呼噜呼噜！',
        '扑进你怀里！双击我可以进入专属小窝哦~',
        '尾巴摇成直升机竹蜻蜓！✨',
        '汪！是不是要带我去吃好吃的呀？',
        '歪头看着你：今天你们有想对方吗？'
      ]
      const pick = quotes[Math.floor(Math.random() * quotes.length)]
      this.showBubble(pick, 1800)

      // 通知父组件触发即时互动保存
      this.triggerEvent('interact', { action: 'touch' })
    },

    // 6. 状态特效切换
    _updateEmotionEffects(state) {
      this.setData({
        showHeartFx: state === 'happy' || state === 'surprise',
        showSweatFx: state === 'sad',
        showZzzFx: state === 'sleepy',
        showBubbleFx: state === 'clean',
        showFoodFx: state === 'feed',
      })
    },

    // 播放指定瞬时交互动作特效 (供外部调用)
    triggerActionFx(action) {
      try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
      if (action === 'feed') {
        this.setData({ showFoodFx: true, isTapped: true, actionState: 'happy' })
        this._scheduleFx(() => this.setData({ showFoodFx: false, isTapped: false }), 1000)
      } else if (action === 'clean') {
        this.setData({ showBubbleFx: true, isTapped: true, actionState: 'happy' })
        this._scheduleFx(() => this.setData({ showBubbleFx: false, isTapped: false }), 1200)
      } else if (action === 'sleep') {
        this.setData({ showZzzFx: true, actionState: 'sleepy' })
        this._scheduleFx(() => this.setData({ showZzzFx: false }), 2000)
      } else if (action === 'touch') {
        this.setData({ showHeartFx: true, isTapped: true, actionState: 'expectant' })
        this._scheduleFx(() => this.setData({ showHeartFx: false, isTapped: false }), 1000)
      } else if (action === 'heal') {
        this.setData({ showHeartFx: true, actionState: 'happy' })
        this._scheduleFx(() => this.setData({ showHeartFx: false }), 1000)
      }
    },

    // 7. 点击状态胶囊打开养成互动弹窗
    openPetModal() {
      this.triggerEvent('openmanage', {})
    },

    _clearAllTimers() {
      if (this._fxTimers) {
        this._fxTimers.forEach(timer => clearTimeout(timer))
        this._fxTimers.clear()
      }
      if (this._idleTimer) clearInterval(this._idleTimer)
      if (this._blinkTimer) clearInterval(this._blinkTimer)
      if (this._blinkResetTimer) clearTimeout(this._blinkResetTimer)
      if (this._bubbleTimer) clearTimeout(this._bubbleTimer)
    }
  }
})
