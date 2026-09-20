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
        if (newVal) {
          if (newVal.actionState) {
            this.setData({ actionState: newVal.actionState })
            this._updateEmotionEffects(newVal.actionState)
          }
          if (newVal.stage) {
            const names = { egg: '萌宠蛋', baby: '幼崽期', youth: '成长期', adult: '完全体' }
            this.setData({ stageName: names[newVal.stage] || '幼崽期' })
          }
        }
      }
    }
  },

  data: {
    stageName: '萌宠蛋',
    actionState: 'normal', // happy | sad | surprise | normal | expectant | sleepy | sick
    idleIndex: 0, // 0: 呼吸, 1: 晃脑摇尾, 2: 歪头杀, 3: 踏步
    isBlinking: false,
    isTapped: false,

    bubbleText: '',
    bubbleAnim: false,

    showHeartFx: false,
    showSweatFx: false,
    showZzzFx: false,
  },

  lifetimes: {
    attached() {
      this._startIdleActionLoop()
      this._startBlinkLoop()
      this._greetOnLoad()
    },
    detached() {
      this._clearAllTimers()
    }
  },

  methods: {
    // 1. 自然循环待机动作切换（3~4个循环自然动作）
    _startIdleActionLoop() {
      if (this._idleTimer) clearInterval(this._idleTimer)
      this._idleTimer = setInterval(() => {
        // 如果当前没有被互动强制改变表情，则随机轮换待机小动作
        if (this.data.actionState === 'normal' || this.data.actionState === 'expectant') {
          const nextIdle = (this.data.idleIndex + 1) % 4
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
          setTimeout(() => this.setData({ isBlinking: false }), 150)
        }
      }, 3500 + Math.random() * 2000)
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

      setTimeout(() => this.setData({ isTapped: false }), 400)
      setTimeout(() => this.setData({ showHeartFx: false }), 1200)

      const quotes = [
        '嗷呜~ 被摸得舒服极啦，呼噜呼噜！',
        '扑进你怀里！双击我可以进入专属小窝哦~',
        '尾巴摇成直升机竹蜻蜓！✨',
        '汪！是不是要带我去吃好吃的呀？',
        '歪头看着你：今天你们有想对方吗？'
      ]
      const pick = quotes[Math.floor(Math.random() * quotes.length)]
      this.showBubble(pick, 2500)

      // 通知父组件触发即时互动保存
      this.triggerEvent('interact', { action: 'poke' })
    },

    // 6. 状态特效切换
    _updateEmotionEffects(state) {
      this.setData({
        showHeartFx: state === 'happy' || state === 'surprise',
        showSweatFx: state === 'sad',
        showZzzFx: state === 'sleepy',
      })
    },

    // 7. 点击状态胶囊打开养成互动弹窗
    openPetModal() {
      this.triggerEvent('openmanage', {})
    },

    _clearAllTimers() {
      if (this._idleTimer) clearInterval(this._idleTimer)
      if (this._blinkTimer) clearInterval(this._blinkTimer)
      if (this._bubbleTimer) clearTimeout(this._bubbleTimer)
    }
  }
})
