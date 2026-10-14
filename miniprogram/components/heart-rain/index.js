// 全屏爱心/闪电粒子特效：show 变为 true 时，飘落/降下一波粒子，结束后触发 done 事件
const LOVE_EMOJIS = ['💗', '💖', '💕', '❤️', '🌸', '✨', '💘', '🩷']
const PUNISH_EMOJIS = ['⚡', '🌩️', '💢', '💥', '⚠️', '🌧️', '⛈️']

Component({
  properties: {
    show: { type: Boolean, value: false },
    type: { type: String, value: 'love' }, // 'love' 爱心雨 | 'punish' 闪电惩罚雨
  },

  data: { hearts: [] },

  observers: {
    show(v) {
      if (v) this.rain()
    },
  },

  lifetimes: {
    detached() {
      if (this._timer) clearTimeout(this._timer)
    },
  },

  methods: {
    rain() {
      const isPunish = this.data.type === 'punish'
      const emojis = isPunish ? PUNISH_EMOJIS : LOVE_EMOJIS
      const count = isPunish ? 24 : 30
      const hearts = Array.from({ length: count }, (_, i) => ({
        id: i,
        emoji: emojis[i % emojis.length],
        left: (Math.random() * 94 + 3).toFixed(2) + '%',
        delay: (Math.random() * (isPunish ? 0.4 : 0.9)).toFixed(2) + 's',
        dur: (isPunish ? (1.0 + Math.random() * 0.8) : (2.2 + Math.random() * 1.4)).toFixed(2) + 's',
        size: (isPunish ? (32 + Math.random() * 24) : (26 + Math.random() * 24)).toFixed(0) + 'rpx',
      }))
      this.setData({ hearts })
      const duration = isPunish ? 2200 : 3400
      this._timer = setTimeout(() => {
        this.setData({ hearts: [] })
        this.triggerEvent('done')
      }, duration)
    },
  },
})
