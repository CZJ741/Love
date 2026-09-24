// 家：余额 · 心情系数 · 快捷赞美 · 积分变动记录 · 冷暴力预警
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')
const config = require('../../lib/config')
const { greeting, isCloudFile, formatTxTime, typeMeta } = require('../../utils/format')

// 快捷赞美预设理由
const PRAISE_REASONS = [
  '今天特别贴心', '好温柔呀', '真可爱', '辛苦了', '笑起来真好看',
  '有你真好', '最爱你了', '今天很帅', '超棒的', '抱抱',
]

// 食物转盘默认初始清单（可本地增删改）
const DEFAULT_FOODS = [
  { id: 'f1', name: '火锅', emoji: '🍲' },
  { id: 'f2', name: '麻辣烫', emoji: '🌶️' },
  { id: 'f3', name: '烧烤', emoji: '🍢' },
  { id: 'f4', name: '奶茶甜品', emoji: '🧋' },
  { id: 'f5', name: '日料寿司', emoji: '🍣' },
  { id: 'f6', name: '汉堡披萨', emoji: '🍔' },
  { id: 'f7', name: '家常小炒', emoji: '🍚' },
  { id: 'f8', name: '牛肉面', emoji: '🍜' },
]

const FOOD_EMOJI_POOL = ['🍲', '🌶️', '🍢', '🧋', '🍣', '🍔', '🍚', '🍜', '🥟', '🥪', '🥘', '🍗', '🥗', '🥞', '🍱']

// 8个柔和可爱的扇区底色
const SECTOR_COLORS = [
  '#FFF3E0', '#FCE4EC', '#E8F5E9', '#E1F5FE',
  '#FFF8E1', '#F3E5F5', '#E0F2F1', '#FFEBEE',
]

Page({
  data: {
    me: { balance: 0, nickname: '', avatar: '' },
    partner: { balance: 0, nickname: 'TA', avatar: '🐰' },
    greeting: {},
    coldWarning: false,

    // 对方在线状态
    partnerOnline: false,
    partnerLastSeen: '',

    // 快捷赞美
    showPraise: false,
    praiseValues: [1, 2, 3, 4, 5],
    praiseAmount: 1,
    praiseReason: PRAISE_REASONS[0],
    praiseReasons: PRAISE_REASONS,

    // 最近流水（家页展示最近 5 条）
    recentTx: [],

    // 点击某条流水展开详情
    showTxDetail: false,
    txDetail: null,

    // 积分变动浮动文字（短暂出现后消失）
    toastText: '',
    toastVisible: false,

    // 签到反馈
    signFeedback: '',

    // 撒花（心愿达成）
    rain: false,

    // 记录本次刷新前的余额，用于检测变化
    _prevBalance: -1,
    _prevPartnerBalance: -1,

    // 余额金光闪烁
    meGlow: false,
    partnerGlow: false,

    // 房间名称（仅展示）
    roomName: '',

    // 对方是否已加入房间
    partnerJoined: false,

    // 陪伴时长与纪念日锁定
    togetherDays: 0,
    togetherStart: '',
    startDateLocked: false,
    togetherBg: '',
    showBgPicker: false,
    showDateModal: false,
    tempStartDate: '',
    todayStr: '',
    bgOptions: [
      { key: 'sunset', value: 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)' },
      { key: 'warm', value: 'linear-gradient(135deg, #FFE0C0 0%, #FFD1A9 100%)' },
      { key: 'pink', value: 'linear-gradient(135deg, #FCE4EC 0%, #F8BBD0 100%)' },
      { key: 'sky', value: 'linear-gradient(135deg, #E0F7FA 0%, #B3E5FC 100%)' },
      { key: 'green', value: 'linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%)' },
      { key: 'lavender', value: 'linear-gradient(135deg, #F3E5F5 0%, #E1BEE7 100%)' },
      { key: 'none', value: '' },
    ],

    // 反向合影打卡简要状态
    puzzleStreak: 0,
    puzzleTheme: '',
    puzzleStatus: 'pending',
    puzzleMyUploaded: false,

    // 食物转盘功能状态
    showFoodWheel: false,
    showFoodManage: false,
    foodWheelList: [],
    wheelConicBg: '',
    wheelRotation: 0,
    wheelTransition: 'none',
    isSpinning: false,
    wheelResult: null,

    // 食物清单编辑相关
    currentFoodEmoji: '🍲',
    foodInputName: '',
    editingFoodId: '',

    // 虚拟桌宠（Live2D 萌犬养成）
    petData: {
      name: '小糯米',
      hunger: 80,
      mood: 85,
      energy: 90,
      level: 1,
      exp: 0,
      actionState: 'normal',
      lastActionText: '小狗正乖巧地待在你们身边',
    },
    showPetModal: false,
  },

  onLoad() {
    this.initFoodList()
    this.fetchPetData()
    this._userCb = realtime.on('users', this.refresh.bind(this))
    this._txCb = realtime.on('transactions', this.onTxRefresh.bind(this))
    this._doneCb = realtime.on('wish-completed', this.onWishCompleted.bind(this))
    this._balCb = realtime.on('balances', this.onBalances.bind(this))
  },

  onShow() {
    this.ensureData()
    realtime.heartbeat()
    this._startOnlineTimer()
    this.fetchPuzzleStatus()
    this.fetchPetData()
  },

  onHide() {
    this._stopOnlineTimer()
  },

  onUnload() {
    this._stopOnlineTimer()
    realtime.off('users', this._userCb)
    realtime.off('transactions', this._txCb)
    realtime.off('wish-completed', this._doneCb)
    realtime.off('balances', this._balCb)
  },

  // -------- 对方在线状态：呼吸小圆点 + 「xxx前在线」 --------
  _startOnlineTimer() {
    this._stopOnlineTimer()
    this._onlineTimer = setInterval(() => {
      const partnerJoined = !!realtime.getPartner()
      this.setData({
        partnerOnline: partnerJoined ? realtime.isPartnerOnline() : false,
        partnerLastSeen: partnerJoined ? realtime.lastSeenText() : '',
      })
    }, 30000)
  },

  _stopOnlineTimer() {
    if (this._onlineTimer) {
      clearInterval(this._onlineTimer)
      this._onlineTimer = null
    }
  },

  ensureData() {
    realtime.fetchOnce().then(() => {
      if (!realtime.getMe()) {
        wx.removeStorageSync('myProfile')
        wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      this.refresh()
      this.onTxRefresh()
      this.fetchRelationshipInfo()
      this.checkAndApplyDecay()
    }).catch(() => {
      this.refresh()
      this.onTxRefresh()
    })
  },

  onPullDownRefresh() {
    realtime.fetchOnce().then(() => {
      this.refresh()
      this.onTxRefresh()
      this.fetchRelationshipInfo()
      this.checkAndApplyDecay()
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },

  // -------- 数据刷新 --------
  refresh() {
    const me = realtime.getMe()
    const partner = realtime.getPartner()
    if (!me) return

    const newBalance = me.balance || 0
    const prev = this.data._prevBalance
    const newPBalance = (partner && partner.balance) || 0
    const prevP = this.data._prevPartnerBalance

    if (prev >= 0 && newBalance !== prev) {
      const diff = newBalance - prev
      this.showBalanceToast(diff > 0 ? `我的积分 +${diff} 🎉` : `我的积分 ${diff}`)
      this._triggerGlow('me')
    }
    if (partner && prevP >= 0 && newPBalance !== prevP) {
      const diff = newPBalance - prevP
      this.showBalanceToast(diff > 0 ? `${partner.nickname} 积分 +${diff} 🎉` : `${partner.nickname} 积分 ${diff}`)
      this._triggerGlow('partner')
    }

    const partnerJoined = !!partner
    this.setData({
      me: { ...me, avatarImg: isCloudFile(me.avatar) },
      partner: partnerJoined ? { ...partner, avatarImg: isCloudFile(partner.avatar) } : { nickname: 'TA', avatar: '🐰', balance: 0 },
      partnerJoined,
      greeting: greeting(),
      coldWarning: realtime.checkColdWarning(),
      roomName: (realtime.getRoomDoc() && realtime.getRoomDoc().name) || '小窝',
      partnerOnline: partnerJoined ? realtime.isPartnerOnline() : false,
      partnerLastSeen: partnerJoined ? realtime.lastSeenText() : '',
      _prevBalance: newBalance,
      _prevPartnerBalance: newPBalance,
    })
    this.calcTogetherDays()
  },

  // 流水变化 → 刷新家页最近列表（仅显示最近 5 条）
  onTxRefresh() {
    const all = realtime.getTransactions().slice(0, 5)
    this.setData({
      recentTx: all.map(t => ({
        ...t,
        _time: formatTxTime(t.createdAt),
        _meta: typeMeta(t.type),
      })),
    })
  },

  // 余额快照变化（来自快速轮询，对方操作后无需刷新即可看到积分变化）
  onBalances(data) {
    if (!data) return
    const me = realtime.getMe()
    const partner = realtime.getPartner()
    if (me) me.balance = data.myBalance
    if (partner) partner.balance = data.partnerBalance
    this.refresh()
  },

  // -------- 积分变动浮动文字 --------
  showBalanceToast(text) {
    if (this._toastTimer) clearTimeout(this._toastTimer)
    this.setData({ toastText: text, toastVisible: true })
    this._toastTimer = setTimeout(() => {
      this.setData({ toastVisible: false, toastText: '' })
    }, 1800)
  },

  // 触发余额金光闪烁动画
  _triggerGlow(role) {
    const key = role === 'me' ? 'meGlow' : 'partnerGlow'
    this.setData({ [key]: true })
    setTimeout(() => { this.setData({ [key]: false }) }, 900)
  },

  // -------- 心愿达成撒花 --------
  onWishCompleted() {
    wx.vibrateShort({ type: 'heavy' })
    this.setData({ rain: true })
  },
  onRainDone() { this.setData({ rain: false }) },

  // -------- 签到 --------
  signIn() {
    api.call('signIn')
      .then(data => {
        wx.showToast({ title: data.msg || '签到成功', icon: 'none' })
        // 即时应用返回的余额（不等待轮询）
        const me = realtime.getMe()
        if (me) me.balance = data.myBalance
        const partner = realtime.getPartner()
        if (partner) partner.balance = data.partnerBalance
        this.refresh()
        realtime.fetchOnce()
      })
      .catch(e => {
        wx.showToast({ title: e.message || '今日已签到', icon: 'none' })
      })
  },

  // -------- 快捷赞美（长按对方头像） --------
  onPartnerLongPress() {
    const partner = realtime.getPartner()
    if (!partner) return wx.showToast({ title: 'TA还没入住小窝哦', icon: 'none' })
    this.setData({
      showPraise: true,
      praiseAmount: 1,
      praiseReason: PRAISE_REASONS[0],
    })
  },
  closePraise() { this.setData({ showPraise: false }) },
  onPraiseAmount(e) { this.setData({ praiseAmount: Number(e.currentTarget.dataset.n) }) },
  onPraiseReason(e) { this.setData({ praiseReason: e.currentTarget.dataset.r }) },

  submitPraise() {
    const partner = realtime.getPartner()
    if (!partner) return wx.showToast({ title: 'TA还没入住小窝哦', icon: 'none' })
    api.call('quickPraise', {
      toOpenid: partner.openid,
      amount: this.data.praiseAmount,
      reason: this.data.praiseReason,
    }).then(data => {
      this.setData({ showPraise: false })
      wx.showToast({ title: data.msg, icon: 'none' })
      // 即时应用返回的余额
      const me = realtime.getMe()
      if (me) me.balance = data.myBalance
      if (partner) partner.balance = data.partnerBalance
      this.refresh()
      realtime.fetchOnce().then(() => {
        this.onTxRefresh()
      })
    }).catch(e => wx.showToast({ title: e.message, icon: 'none' }))
  },

  // -------- 流水详情弹窗 --------
  onTxTap(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const tx = this.data.recentTx[idx]
    if (!tx) return
    this.setData({ showTxDetail: true, txDetail: tx })
  },
  closeTxDetail() { this.setData({ showTxDetail: false }) },

  goTxHistory() {
    wx.navigateTo({ url: '/pages/tx-history/tx-history' })
  },

  goPoints() {
    wx.switchTab({ url: '/pages/points/points' })
  },

  goDatebox() {
    wx.navigateTo({ url: '/pages/datebox/datebox' })
  },

  goPuzzle() {
    wx.navigateTo({ url: '/pages/puzzle/puzzle' })
  },

  goGameLobby() {
    wx.navigateTo({ url: '/pages/game/game' })
  },

  goLocation() {
    wx.navigateTo({ url: '/pages/location/location' })
  },

  fetchPuzzleStatus() {
    api.call('puzzleGetStreak')
      .then(res => {
        if (!res) return
        this.setData({
          puzzleStreak: res.completedGroups || 0,
          puzzleTheme: res.theme || '',
          puzzleStatus: res.status || 'pending',
          puzzleMyUploaded: Boolean(res.myUploaded),
        })
      })
      .catch(() => {})
  },

  // -------- 邀请 TA 入住（右上角分享 / 首页「邀请TA」按钮） --------
  onShareAppMessage() {
    const me = realtime.getMe()
    const roomId = me && me.roomId
    return {
      title: '邀请你住进我们的小窝 🏠💕',
      path: roomId ? `/pages/index/index?roomId=${roomId}` : '/pages/index/index',
    }
  },

  // -------- 陪伴时长与纪念日设置 --------
  fetchRelationshipInfo() {
    const today = new Date()
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    this.setData({ todayStr })

    api.call('getRelationshipInfo', {})
      .then(data => {
        const d = data.data || data
        const startDate = d.startDate || ''
        const startDateLocked = Boolean(d.startDateLocked || startDate)
        const me = realtime.getMe()
        const isHost = me ? Boolean(me.host) : Boolean(d.isHost)

        this.setData({
          togetherStart: startDate,
          startDateLocked,
          togetherBg: d.cardBg || '',
          tempStartDate: startDate || todayStr,
        })

        if (startDate) {
          this.calcTogetherDays()
        } else {
          this.setData({ togetherDays: 0 })
          // 当双方到齐且当前用户为房主、且尚未设置纪念日时，主动引导房主设置
          const partner = realtime.getPartner()
          if (partner && isHost && !this._promptedDate) {
            this._promptedDate = true
            this.setData({ showDateModal: true })
          }
        }
      })
      .catch(() => {})
  },

  calcTogetherDays() {
    const start = this.data.togetherStart
    if (!start) {
      this.setData({ togetherDays: 0 })
      return
    }
    const startDate = new Date(start.replace(/-/g, '/'))
    if (isNaN(startDate.getTime())) return
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diff = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    this.setData({ togetherDays: Math.max(0, diff) })
  },

  // 点击卡片：未锁定且是房主时打开选日弹窗；已锁定则只支持长按换背景
  onTogetherCardTap() {
    const me = realtime.getMe()
    const isHost = me ? Boolean(me.host) : false
    if (!this.data.startDateLocked) {
      if (isHost) {
        if (!this.data.partnerJoined) {
          wx.showToast({ title: '等待TA加入小窝', icon: 'none' })
          return
        }
        this.setData({ showDateModal: true })
      } else {
        wx.showToast({ title: '等待房主设定起始日', icon: 'none' })
      }
    }
  },

  onDateChange(e) {
    this.setData({ tempStartDate: e.detail.value })
  },

  closeDateModal() {
    this.setData({ showDateModal: false })
  },

  confirmStartDate() {
    const date = this.data.tempStartDate
    if (!date) return
    wx.showLoading({ title: '保存中...' })
    api.call('setRelationshipInfo', { startDate: date })
      .then(() => {
        wx.hideLoading()
        this.setData({
          togetherStart: date,
          startDateLocked: true,
          showDateModal: false,
        })
        this.calcTogetherDays()
        wx.showToast({ title: '纪念日已锁定', icon: 'success' })
      })
      .catch(e => {
        wx.hideLoading()
        wx.showToast({ title: e.message || '设置失败', icon: 'none' })
      })
  },

  showBgPicker() {
    this.setData({ showBgPicker: true })
  },
  closeBgPicker() { this.setData({ showBgPicker: false }) },

  selectBg(e) {
    const val = e.currentTarget.dataset.val
    this.setData({ togetherBg: val, showBgPicker: false })
    api.call('setRelationshipInfo', { cardBg: val }).catch(() => {})
  },

  // -------- 冷暴力预警 --------
  sendCold() {
    if (!config.COLD_TEMPLATE_ID) {
      wx.showModal({
        title: '冷暴力预警',
        content: '在「我-设置」配置订阅消息模板后，3天没互动会自动提醒你们哦~',
        showCancel: false,
      })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [config.COLD_TEMPLATE_ID],
      success: () => {
        api.call('sendColdReminder')
          .then(d => wx.showToast({ title: d.msg, icon: 'none' }))
          .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      },
    })
  },

  // -------- 检查并应用积分削减（3天以上未互动惩罚） --------
  checkAndApplyDecay() {
    if (this._checkingDecay) return
    this._checkingDecay = true
    api.call('checkDecay')
      .then(res => {
        this._checkingDecay = false
        if (res && res.decayed) {
          const { pendingDays, myDeducted } = res
          // 如果产生扣分，弹窗温和提醒双方互动
          wx.showModal({
            title: '❄️ 小窝有点变冷了',
            content: `你们已经超过 3 天没有互动啦！累计扣除了 ${pendingDays} 天的未互动降温积分（扣除 ${myDeducted} 分）。快去给对方发个糖温存一下吧 💕`,
            showCancel: false,
            confirmText: '马上去发糖',
          })
          // 重新拉取最新余额及流水
          realtime.fetchOnce().then(() => {
            this.refresh()
            this.onTxRefresh()
          })
        }
      })
      .catch(() => {
        this._checkingDecay = false
      })
  },

  // ======== 食物转盘功能 ========
  // 初始化/读取本地食物清单
  initFoodList() {
    let list = wx.getStorageSync('custom_food_list')
    if (!list || !Array.isArray(list) || !list.length) {
      list = JSON.parse(JSON.stringify(DEFAULT_FOODS))
      wx.setStorageSync('custom_food_list', list)
    }
    this.updateFoodWheelData(list)
  },

  // 计算每个扇区在转盘中的旋转角度与对应底色
  updateFoodWheelData(list) {
    const n = list.length
    const angleStep = n > 0 ? 360 / n : 360

    // 生成动态 conic-gradient 背景：第 idx 个扇区范围为 [idx * angleStep, (idx + 1) * angleStep]
    // 文字放在该扇区正中央，即角平分线方向：(idx + 0.5) * angleStep
    const conicParts = []
    const processed = list.map((item, idx) => {
      const startDeg = idx * angleStep
      const endDeg = (idx + 1) * angleStep
      const color = SECTOR_COLORS[idx % SECTOR_COLORS.length]
      conicParts.push(`${color} ${startDeg}deg ${endDeg}deg`)
      return {
        ...item,
        angle: Number(((idx + 0.5) * angleStep).toFixed(2)),
      }
    })

    const wheelConicBg = n > 0 ? `conic-gradient(${conicParts.join(', ')})` : '#FFF3E0'
    this.setData({
      foodWheelList: processed,
      wheelConicBg,
    })
  },

  openFoodWheel() {
    this.setData({
      showFoodWheel: true,
      wheelResult: null,
    })
  },

  closeFoodWheel() {
    if (this.data.isSpinning) return
    this.setData({ showFoodWheel: false })
  },

  // 开始转动抽奖
  spinFoodWheel() {
    if (this.data.isSpinning) return
    const list = this.data.foodWheelList
    if (!list || list.length < 2) {
      wx.showToast({ title: '请至少保留2种食物哦', icon: 'none' })
      return
    }

    const count = list.length
    // 随机选中一项
    const winIdx = Math.floor(Math.random() * count)
    const winItem = list[winIdx]

    // 扇区角度与计算：指针在 12 点钟方向 (0°/360°)
    // 第 winIdx 个扇区的中心位于 (winIdx + 0.5) * (360 / count)°
    // 顺时针旋转转盘，使该扇区中心正对 0° 指针：
    // targetAngle = 360 - (winIdx + 0.5) * (360 / count)
    const sectorAngle = 360 / count
    const targetSectorDeg = (360 - (winIdx + 0.5) * sectorAngle) % 360

    // 在已有角度基础上，顺时针额外多转 5~8 圈（高速旋转感）
    const extraRounds = 5 + Math.floor(Math.random() * 3)
    const currentRot = this.data.wheelRotation
    const baseRot = Math.ceil(currentRot / 360) * 360
    const finalRot = baseRot + extraRounds * 360 + targetSectorDeg

    // 触发震动并启动动画
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}

    this.setData({
      isSpinning: true,
      wheelResult: null,
      wheelTransition: 'transform 3.8s cubic-bezier(0.18, 0.89, 0.32, 1.01)',
      wheelRotation: finalRot,
    })

    if (this._spinTimer) clearTimeout(this._spinTimer)
    this._spinTimer = setTimeout(() => {
      try { wx.vibrateShort({ type: 'heavy' }) } catch (e) {}
      this.setData({
        isSpinning: false,
        wheelResult: winItem,
      })
    }, 4000)
  },

  // 打开食物清单管理
  openFoodManage() {
    if (this.data.isSpinning) return
    this.setData({
      showFoodManage: true,
      editingFoodId: '',
      foodInputName: '',
      currentFoodEmoji: '🍲',
    })
  },

  closeFoodManage() {
    this.setData({
      showFoodManage: false,
      editingFoodId: '',
      foodInputName: '',
    })
  },

  // 切换候选 emoji
  cycleInputEmoji() {
    const cur = this.data.currentFoodEmoji
    const idx = FOOD_EMOJI_POOL.indexOf(cur)
    const nextIdx = (idx + 1) % FOOD_EMOJI_POOL.length
    this.setData({ currentFoodEmoji: FOOD_EMOJI_POOL[nextIdx] })
  },

  onFoodInputName(e) {
    this.setData({ foodInputName: e.detail.value })
  },

  // 添加新食物
  addFood() {
    const name = (this.data.foodInputName || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }
    const list = [...this.data.foodWheelList]
    if (list.length >= 16) {
      wx.showToast({ title: '食物转盘最多容纳16种美食哦', icon: 'none' })
      return
    }
    const newItem = {
      id: 'f_' + Date.now(),
      name,
      emoji: this.data.currentFoodEmoji,
    }
    list.push(newItem)
    wx.setStorageSync('custom_food_list', list)
    this.updateFoodWheelData(list)
    this.setData({
      foodInputName: '',
      currentFoodEmoji: FOOD_EMOJI_POOL[(FOOD_EMOJI_POOL.indexOf(this.data.currentFoodEmoji) + 1) % FOOD_EMOJI_POOL.length],
    })
    wx.showToast({ title: '添加成功', icon: 'none' })
  },

  // 开始编辑食物
  startEditFood(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.foodWheelList.find(x => x.id === id)
    if (!item) return
    this.setData({
      editingFoodId: id,
      foodInputName: item.name,
      currentFoodEmoji: item.emoji || '🍲',
    })
  },

  // 保存修改
  saveEditFood() {
    const name = (this.data.foodInputName || '').trim()
    if (!name) {
      wx.showToast({ title: '食物名称不能为空', icon: 'none' })
      return
    }
    const list = this.data.foodWheelList.map(item => {
      if (item.id === this.data.editingFoodId) {
        return { ...item, name, emoji: this.data.currentFoodEmoji }
      }
      return item
    })
    wx.setStorageSync('custom_food_list', list)
    this.updateFoodWheelData(list)
    this.setData({
      editingFoodId: '',
      foodInputName: '',
    })
    wx.showToast({ title: '已修改', icon: 'none' })
  },

  // 取消编辑
  cancelEditFood() {
    this.setData({
      editingFoodId: '',
      foodInputName: '',
    })
  },

  // 删除食物
  deleteFood(e) {
    const id = e.currentTarget.dataset.id
    const list = this.data.foodWheelList
    if (list.length <= 2) {
      wx.showToast({ title: '至少保留2项才能抽奖哦', icon: 'none' })
      return
    }
    const filtered = list.filter(x => x.id !== id)
    wx.setStorageSync('custom_food_list', filtered)
    this.updateFoodWheelData(filtered)
    if (this.data.editingFoodId === id) {
      this.cancelEditFood()
    }
    wx.showToast({ title: '已删除', icon: 'none' })
  },

  // 恢复预设菜单
  resetDefaultFoods() {
    wx.showModal({
      title: '恢复预设',
      content: '确定要将食物列表重置为初始推荐菜单吗？',
      success: res => {
        if (res.confirm) {
          const list = JSON.parse(JSON.stringify(DEFAULT_FOODS))
          wx.setStorageSync('custom_food_list', list)
          this.updateFoodWheelData(list)
          this.cancelEditFood()
          wx.showToast({ title: '已恢复预设', icon: 'none' })
        }
      },
    })
  },

  // ============ 虚拟桌宠养成与互动逻辑 ============
  fetchPetData() {
    api.call('petGet')
      .then(res => {
        if (res && res.pet) {
          this.setData({ petData: res.pet })
        }
      })
      .catch(() => {})
  },

  // 接收 Live2D 桌宠触发的点击互动事件
  onPetInteract(e) {
    const action = (e.detail && e.detail.action) || 'poke'
    api.call('petInteract', { action })
      .then(res => {
        if (res && res.pet) {
          this.setData({ petData: res.pet })
        }
      })
      .catch(() => {})
  },

  // 跳转到专属双人宠物页面
  goPetPage() {
    wx.navigateTo({ url: '/pages/pet/pet' })
  },

  openPetModal() {
    this.setData({ showPetModal: true })
    this.fetchPetData()
  },

  closePetModal() {
    this.setData({ showPetModal: false })
  },

  // 弹窗中触发养成操作（喂食、摸摸、玩耍、送礼、睡眠）
  doPetAction(e) {
    const act = e.currentTarget.dataset.act
    if (!act) return

    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    wx.showLoading({ title: '互动中...' })

    api.call('petInteract', { action: act })
      .then(res => {
        wx.hideLoading()
        if (res && res.pet) {
          this.setData({ petData: res.pet })
        }
        if (res && res.replyText) {
          wx.showToast({ title: res.replyText, icon: 'none', duration: 2500 })
        }
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
  },

  // 修改宠物专属名字
  promptRenamePet() {
    wx.showModal({
      title: '给萌宠起个名字',
      editable: true,
      placeholderText: this.data.petData.name || '小糯米',
      success: res => {
        if (res.confirm && res.content) {
          const name = res.content.trim()
          if (!name) return
          wx.showLoading({ title: '修改中...' })
          api.call('petRename', { name })
            .then(() => {
              wx.hideLoading()
              this.fetchPetData()
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

  noop() {},
})