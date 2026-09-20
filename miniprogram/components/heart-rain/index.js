// 全屏爱心粒子特效：show 变为 true 时，飘落一波爱心，结束后触发 done 事件
const EMOJIS = ['💗', '💖', '💕', '❤️', '🌸', '✨', '💘', '🩷']
Component({
  properties: {
    show: { type: Boolean, value: false },
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
      const hearts = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        emoji: EMOJIS[i % EMOJIS.length],
        left: (Math.random() * 96 + 2).toFixed(2) + '%',
        delay: (Math.random() * 0.9).toFixed(2) + 's',
        dur: (2.2 + Math.random() * 1.4).toFixed(2) + 's',
        size: (26 + Math.random() * 24).toFixed(0) + 'rpx',
      }))
      this.setData({ hearts })
      this._timer = setTimeout(() => {
        this.setData({ hearts: [] })
        this.triggerEvent('done')
      }, 3400)
    },
  },
})
