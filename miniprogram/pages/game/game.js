// 游戏大厅（选定游戏列表 & 四大经典对战：五子棋、围棋、飞行棋、海战棋）页面逻辑
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')

const GOBANG_STAR_POINTS = [
  { r: 3, c: 3 }, { r: 3, c: 11 },
  { r: 7, c: 7 },
  { r: 11, c: 3 }, { r: 11, c: 11 }
]

const WEIQI_STAR_POINTS = [
  { r: 3, c: 3 }, { r: 3, c: 9 },
  { r: 6, c: 6 },
  { r: 9, c: 3 }, { r: 9, c: 9 }
]

const GAME_META = {
  gobang: { title: '五子棋', emoji: '⚪⚫' },
  weiqi: { title: '围棋', emoji: '☯️' },
  ludo: { title: '双人飞行棋', emoji: '✈️' },
  seabattle: { title: '海战棋', emoji: '🚢' },
}

Page({
  data: {
    currentView: 'lobby', // 'lobby' | 'play'
    currentGameType: 'gobang',
    gameMeta: GAME_META.gobang,

    lobbyStatus: {
      gobang: { statusText: '点击开始对弈', isMyTurn: false },
      weiqi: { statusText: '点击开始对弈', isMyTurn: false },
      ludo: { statusText: '点击开始起飞', isMyTurn: false },
      seabattle: { statusText: '点击排兵布阵', isMyTurn: false },
    },

    // 棋类状态
    boardSize: 15,
    starPoints: GOBANG_STAR_POINTS,
    board: [],

    // 飞行棋状态
    ludoCells: [],
    diceRolling: false,

    // 海战棋状态
    seaAttacks: [],
    myFleet: [],

    // 通用对局信息
    game: null,
    myRole: '',
    partnerRole: '',
    isMyTurn: false,
    isP1Turn: false,
    isP2Turn: false,
    isWon: false,
    isSolo: false,
    turnNoticeText: '加载对局中...',
    blackUser: {},
    whiteUser: {},
    submitting: false,

    // 网络状态显示 (player1 & player2)
    player1NetStatus: { text: '连接中', level: 'warn' },
    player2NetStatus: { text: '连接中', level: 'warn' },
  },

  // 内部监听器与计时器
  _gameWatcher: null,
  _lobbyTimer: null,
  _netTimer: null,
  _currentGameId: null,

  onLoad(options) {
    this._initLudoCells()
    this._initNetworkListener()

    if (options && options.game) {
      this.setData({
        currentView: 'play',
        currentGameType: options.game,
        gameMeta: GAME_META[options.game] || GAME_META.gobang
      })
      this.initBoardConfig(options.game)
      this.fetchGameData()
    } else {
      this.fetchLobbyOverview()
    }

    // 监听全局 users 变更，同步网络与状态
    realtime.on('users', this._onUsersChange = () => {
      this._updateBothNetworkStatus()
    })
  },

  onShow() {
    realtime.heartbeat(true)
    this._startLobbyPolling()
    this._startNetTicker()

    if (this.data.currentView === 'play') {
      this.fetchGameData(true)
    } else {
      this.fetchLobbyOverview(true)
    }
  },

  onHide() {
    this._stopGameWatcher()
    this._stopLobbyPolling()
    this._stopNetTicker()
  },

  onUnload() {
    this._stopGameWatcher()
    this._stopLobbyPolling()
    this._stopNetTicker()
    if (this._onUsersChange) {
      realtime.off('users', this._onUsersChange)
    }
  },

  onPullDownRefresh() {
    if (this.data.currentView === 'play') {
      this.fetchGameData(true).finally(() => wx.stopPullDownRefresh())
    } else {
      this.fetchLobbyOverview(true).finally(() => wx.stopPullDownRefresh())
    }
  },

  _initLudoCells() {
    const cells = []
    for (let i = 0; i <= 30; i++) {
      cells.push({
        index: i,
        isStart: i === 0,
        isEnd: i === 30,
      })
    }
    this.setData({ ludoCells: cells })
  },

  // ================= 实时网络监听与状态判定 =================
  _initNetworkListener() {
    if (wx.onNetworkStatusChange) {
      wx.onNetworkStatusChange(() => {
        this._updateBothNetworkStatus()
      })
    }
  },

  _startNetTicker() {
    this._stopNetTicker()
    this._updateBothNetworkStatus()
    this._netTimer = setInterval(() => {
      realtime.heartbeat()
      this._updateBothNetworkStatus()
    }, 10000)
  },

  _stopNetTicker() {
    if (this._netTimer) {
      clearInterval(this._netTimer)
      this._netTimer = null
    }
  },

  _resolveUserNet(user, isMe, isSolo) {
    if (isSolo && !isMe) {
      return { text: '单机演练', level: 'solo' }
    }
    if (isMe) {
      const type = (realtime.getMyNetworkType && realtime.getMyNetworkType()) || 'wifi'
      const typeMap = { wifi: 'WiFi良好', '5g': '5G在线', '4g': '4G在线', '3g': '3G弱网', '2g': '2G慢速', none: '网络断开' }
      const level = (type === 'none') ? 'bad' : ((type === '2g' || type === '3g') ? 'warn' : 'good')
      return { text: typeMap[type] || `${type.toUpperCase()}在线`, level }
    }

    // 对方网络判断：根据 lastActiveAt 与 networkType
    if (!user || !user.lastActiveAt) {
      return { text: '离线', level: 'bad' }
    }

    let ts = 0
    if (user.lastActiveAt instanceof Date) ts = user.lastActiveAt.getTime()
    else if (typeof user.lastActiveAt === 'number') ts = user.lastActiveAt
    else if (typeof user.lastActiveAt === 'string') ts = new Date(user.lastActiveAt).getTime()

    if (!ts || isNaN(ts)) return { text: '离线', level: 'bad' }

    const diff = Date.now() - ts
    const netType = (user.networkType || '4g').toUpperCase()

    if (diff <= 35 * 1000) {
      return { text: `${netType}在线`, level: 'good' }
    } else if (diff <= 90 * 1000) {
      return { text: '网络波动', level: 'warn' }
    } else if (diff <= 300 * 1000) {
      return { text: '暂时离开', level: 'warn' }
    } else {
      return { text: '离线', level: 'bad' }
    }
  },

  _updateBothNetworkStatus() {
    const { blackUser, whiteUser, myRole, isSolo } = this.data
    const isMeP1 = (myRole === 'black' || myRole === 'player1')
    const isMeP2 = (myRole === 'white' || myRole === 'player2')

    const p1Net = this._resolveUserNet(blackUser, isMeP1, isSolo)
    const p2Net = this._resolveUserNet(whiteUser, isMeP2, isSolo)

    this.setData({
      player1NetStatus: p1Net,
      player2NetStatus: p2Net,
    })
  },

  // ================= 实时在线 Watch 模块 =================
  _startGameWatcher(gameId) {
    if (!gameId) return
    if (this._gameWatcher && this._currentGameId === gameId) return

    this._stopGameWatcher()
    this._currentGameId = gameId

    try {
      const db = wx.cloud.database()
      this._gameWatcher = db.collection('board_games').doc(gameId).watch({
        onChange: (snapshot) => {
          if (!snapshot.docs || !snapshot.docs.length) return
          const updatedDoc = snapshot.docs[0]
          this._applyRealtimeGameDoc(updatedDoc)
        },
        onError: (err) => {
          console.warn('[board_games watch error]', err)
        }
      })
    } catch (e) {
      console.warn('watch not supported or failed', e)
    }
  },

  _stopGameWatcher() {
    if (this._gameWatcher) {
      try { this._gameWatcher.close() } catch (e) {}
      this._gameWatcher = null
      this._currentGameId = null
    }
  },

  _applyRealtimeGameDoc(doc) {
    if (!doc || this.data.currentView !== 'play') return
    const { myRole, currentGameType } = this.data
    const isPlaying = doc.status === 'playing'
    const turnRole = (doc.currentTurn === 'black' || doc.currentTurn === 'player1') ? 'player1' : 'player2'
    const isMyTurn = isPlaying && (this.data.isSolo || turnRole === myRole)

    const isP1Turn = doc.currentTurn === 'black' || doc.currentTurn === 'player1'
    const isP2Turn = doc.currentTurn === 'white' || doc.currentTurn === 'player2'

    const isWon = (doc.status === 'black_win' && myRole === 'black') ||
                  (doc.status === 'white_win' && myRole === 'white') ||
                  (doc.status === 'player1_win' && myRole === 'player1') ||
                  (doc.status === 'player2_win' && myRole === 'player2')

    let safeDoc = { ...doc }
    if (!safeDoc.lastMove || typeof safeDoc.lastMove !== 'object') {
      if (safeDoc.lastR !== undefined && safeDoc.lastR >= 0) {
        safeDoc.lastMove = { r: safeDoc.lastR, c: safeDoc.lastC, piece: safeDoc.lastPiece }
      } else {
        safeDoc.lastMove = {}
      }
    }

    const nextData = {
      game: safeDoc,
      isMyTurn,
      isP1Turn,
      isP2Turn,
      isWon,
    }

    if (currentGameType === 'gobang' || currentGameType === 'weiqi') {
      if (safeDoc.board) nextData.board = safeDoc.board
    } else if (currentGameType === 'seabattle') {
      const myAttacks = myRole === 'player1' ? safeDoc.player1Attacks : safeDoc.player2Attacks
      const myFleet = myRole === 'player1' ? safeDoc.player1Ships : safeDoc.player2Ships
      if (myAttacks) nextData.seaAttacks = myAttacks
      if (myFleet) nextData.myFleet = myFleet
    }

    this.setData(nextData)
    this.updateNoticeText()
  },

  // 大厅后台定时轮询保活
  _startLobbyPolling() {
    this._stopLobbyPolling()
    this._lobbyTimer = setInterval(() => {
      if (this.data.currentView === 'lobby') {
        this.fetchLobbyOverview(true)
      } else if (!this._gameWatcher) {
        // 若 watch 不可用，自动降级为平滑轮询
        this.fetchGameData(true)
      }
    }, 4000)
  },

  _stopLobbyPolling() {
    if (this._lobbyTimer) {
      clearInterval(this._lobbyTimer)
      this._lobbyTimer = null
    }
  },

  // 1. 获取大厅概览
  fetchLobbyOverview(quiet = false) {
    if (!quiet) wx.showLoading({ title: '加载中...' })
    return api.call('gameLobbyGet', {})
      .then(res => {
        const overview = (res && res.overview) || {}
        const lobbyStatus = {
          gobang: this._formatLobbyItem(overview.gobang),
          weiqi: this._formatLobbyItem(overview.weiqi),
          ludo: this._formatLobbyItem(overview.ludo),
          seabattle: this._formatLobbyItem(overview.seabattle),
        }
        this.setData({ lobbyStatus })
      })
      .catch(() => {})
      .finally(() => {
        if (!quiet) wx.hideLoading()
      })
  },

  _formatLobbyItem(item) {
    if (!item) return { statusText: '未开始 · 点击对战', isMyTurn: false }
    if (item.status === 'playing') {
      if (item.isMyTurn) {
        return { statusText: '✨ 轮到你行动啦', isMyTurn: true }
      }
      return { statusText: '⏳ 对方思考中', isMyTurn: false }
    }
    if (item.status === 'draw') {
      return { statusText: '双方和棋/握手言和', isMyTurn: false }
    }
    if (item.status && item.status.includes('win')) {
      const myWon = (item.status.includes('player1') && item.myRole === 'player1') ||
                    (item.status.includes('player2') && item.myRole === 'player2') ||
                    (item.status === 'black_win' && item.myRole === 'black') ||
                    (item.status === 'white_win' && item.myRole === 'white')
      return { statusText: myWon ? '🎉 上局你获胜了' : 'TA获胜了', isMyTurn: false }
    }
    return { statusText: '点击继续对战', isMyTurn: false }
  },

  // 2. 选择游戏
  selectGame(e) {
    const gameType = e.currentTarget.dataset.type
    if (!gameType) return
    this.setData({
      currentView: 'play',
      currentGameType: gameType,
      gameMeta: GAME_META[gameType] || GAME_META.gobang
    })
    this.initBoardConfig(gameType)
    this.fetchGameData()
  },

  // 3. 返回大厅
  backToLobby() {
    this._stopGameWatcher()
    this.setData({ currentView: 'lobby' })
    this.fetchLobbyOverview(true)
  },

  initBoardConfig(type) {
    if (type === 'gobang') {
      this.setData({ boardSize: 15, starPoints: GOBANG_STAR_POINTS })
    } else if (type === 'weiqi') {
      this.setData({ boardSize: 13, starPoints: WEIQI_STAR_POINTS })
    }
  },

  // 4. 获取游戏详情
  fetchGameData(quiet = false) {
    if (!quiet) wx.showLoading({ title: '加载中...' })
    return api.call('gameGet', { gameType: this.data.currentGameType })
      .then(res => {
        if (!res) return
        const { game, myRole, partnerRole, isMyTurn, isSolo, me, partner } = res
        const isBlackOrP1 = (game.blackOpenid === me.openid || game.player1Openid === me.openid)
        const blackUser = isBlackOrP1 ? me : (partner || {})
        const whiteUser = isBlackOrP1 ? (partner || {}) : me

        const isP1Turn = game.currentTurn === 'black' || game.currentTurn === 'player1'
        const isP2Turn = game.currentTurn === 'white' || game.currentTurn === 'player2'
        const isWon = (game.status === 'black_win' && myRole === 'black') ||
                      (game.status === 'white_win' && myRole === 'white') ||
                      (game.status === 'player1_win' && myRole === 'player1') ||
                      (game.status === 'player2_win' && myRole === 'player2')

        this.setData({
          game,
          board: game.board || [],
          seaAttacks: game.myAttacks || [],
          myFleet: game.myShips || [],
          myRole,
          partnerRole,
          isMyTurn,
          isP1Turn,
          isP2Turn,
          isWon,
          isSolo: Boolean(isSolo),
          blackUser,
          whiteUser,
        })
        this.updateNoticeText()
        this._updateBothNetworkStatus()
        // 开启当前对局的实时长连接监听
        if (game && game._id) {
          this._startGameWatcher(game._id)
        }
      })
      .catch(err => {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      })
      .finally(() => {
        if (!quiet) wx.hideLoading()
      })
  },

  updateNoticeText() {
    const { game, isMyTurn, isSolo, currentGameType, isWon } = this.data
    if (!game) return

    if (game.status === 'playing') {
      if (isMyTurn) {
        if (isSolo) {
          this.setData({ turnNoticeText: '单人演练模式，轮到当前角色行动' })
        } else if (currentGameType === 'gobang' || currentGameType === 'weiqi') {
          this.setData({ turnNoticeText: '轮到你落子，点击交叉点下棋' })
        } else if (currentGameType === 'ludo') {
          this.setData({ turnNoticeText: '轮到你投掷骰子，快来起飞！' })
        } else if (currentGameType === 'seabattle') {
          this.setData({ turnNoticeText: '轮到你开火，点击海域指定炮击点！' })
        }
      } else {
        this.setData({ turnNoticeText: '对方行动中，对局实时同步中…' })
      }
    } else if (game.status === 'draw') {
      this.setData({ turnNoticeText: '双方握手言和，平局终局！' })
    } else {
      if (isWon) {
        this.setData({ turnNoticeText: '🎉 恭喜你赢得本局胜利！' })
      } else {
        this.setData({ turnNoticeText: '本局TA获胜了，点击“新开一局”再次挑战吧！' })
      }
    }
  },

  // 5. 五子棋 / 围棋落子
  onCellTap(e) {
    const { r, c } = e.currentTarget.dataset
    const row = parseInt(r, 10)
    const col = parseInt(c, 10)
    const { game, isMyTurn, board, submitting } = this.data

    if (submitting) return
    if (!game || game.status !== 'playing') {
      wx.showToast({ title: '对局已结束，请新开一局', icon: 'none' })
      return
    }
    if (!isMyTurn) {
      wx.showToast({ title: '还没轮到你落子哦', icon: 'none' })
      return
    }
    if (board[row] && board[row][col] !== 0) {
      wx.showToast({ title: '此处已有棋子', icon: 'none' })
      return
    }

    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}

    this.setData({ submitting: true })
    wx.showLoading({ title: '落子中...' })

    api.call('gameMove', {
      gameId: game._id,
      r: row,
      c: col
    })
      .then(res => {
        wx.hideLoading()
        try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
        this.fetchGameData(true)
        if (res && res.winner) {
          wx.showModal({
            title: '对局结束',
            content: res.winner === this.data.myRole ? '🎉 恭喜你赢下了这一局！' : 'TA赢得了本局对弈~',
            showCancel: false,
          })
        }
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '落子失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 6. 飞行棋掷骰子
  onRollDice() {
    const { game, isMyTurn, submitting, diceRolling } = this.data
    if (submitting || diceRolling) return
    if (!game || game.status !== 'playing') {
      wx.showToast({ title: '对局已结束，请新开一局', icon: 'none' })
      return
    }
    if (!isMyTurn) {
      wx.showToast({ title: '还没轮到你投掷哦', icon: 'none' })
      return
    }

    this.setData({ diceRolling: true, submitting: true })
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}

    api.call('gameRollDice', { gameId: game._id })
      .then(res => {
        setTimeout(() => {
          this.setData({ diceRolling: false, submitting: false })
          this.fetchGameData(true)
          if (res && res.winner) {
            wx.showModal({
              title: '对局结束',
              content: res.winner === this.data.myRole ? '🎉 战机率先抵达终点，你赢啦！' : 'TA率先抵达终点获胜~',
              showCancel: false,
            })
          }
        }, 500)
      })
      .catch(err => {
        this.setData({ diceRolling: false, submitting: false })
        wx.showToast({ title: err.message || '掷骰子失败', icon: 'none' })
      })
  },

  // 7. 海战棋攻击海域
  onSeaAttackTap(e) {
    const { r, c } = e.currentTarget.dataset
    const row = parseInt(r, 10)
    const col = parseInt(c, 10)
    const { game, isMyTurn, seaAttacks, submitting } = this.data

    if (submitting) return
    if (!game || game.status !== 'playing') {
      wx.showToast({ title: '对局已结束，请新开一局', icon: 'none' })
      return
    }
    if (!isMyTurn) {
      wx.showToast({ title: '还没轮到你开火哦', icon: 'none' })
      return
    }
    if (seaAttacks[row] && seaAttacks[row][col] !== 0) {
      wx.showToast({ title: '该坐标已炮击过啦', icon: 'none' })
      return
    }

    try { wx.vibrateShort({ type: 'heavy' }) } catch (err) {}
    this.setData({ submitting: true })
    wx.showLoading({ title: '炮火开火中...' })

    api.call('gameSeaAttack', {
      gameId: game._id,
      r: row,
      c: col
    })
      .then(res => {
        wx.hideLoading()
        this.fetchGameData(true)
        if (res && res.winner) {
          wx.showModal({
            title: '海战胜利',
            content: res.winner === this.data.myRole ? '💥 全歼敌方舰队，你赢下了海战！' : '我方舰队全军覆没~',
            showCancel: false,
          })
        }
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '开火失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  // 8. 围棋停一手
  onPass() {
    const { game, isMyTurn } = this.data
    if (!game || game.status !== 'playing' || !isMyTurn) return

    wx.showModal({
      title: '停一手 (Pass)',
      content: '确定要放弃本次落子回合吗？若双方连续Pass将视为终局。',
      confirmText: '确定Pass',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '提交中...' })
          api.call('gamePass', { gameId: game._id })
            .then(() => {
              wx.hideLoading()
              this.fetchGameData(true)
              wx.showToast({ title: '已停一手', icon: 'none' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '操作失败', icon: 'none' })
            })
        }
      }
    })
  },

  // 9. 认输
  onResign() {
    const { game } = this.data
    if (!game || game.status !== 'playing') return

    wx.showModal({
      title: '认输确认',
      content: '确定要向TA认输吗？',
      confirmText: '认输',
      confirmColor: '#E53935',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          api.call('gameResign', { gameId: game._id })
            .then(() => {
              wx.hideLoading()
              this.fetchGameData(true)
              wx.showToast({ title: '已认输', icon: 'none' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '操作失败', icon: 'none' })
            })
        }
      }
    })
  },

  onRefresh() {
    this.fetchGameData().then(() => {
      wx.showToast({ title: '已同步最新状态', icon: 'none' })
    })
  },

  // 10. 重开
  onResetGame() {
    const { game, currentGameType } = this.data
    wx.showModal({
      title: '新开一局',
      content: '确定要重开一局新对决吗？当前对局将被重置。',
      confirmText: '确定重开',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '重置中...' })
          api.call('gameReset', {
            gameId: game ? game._id : undefined,
            gameType: currentGameType
          })
            .then(() => {
              wx.hideLoading()
              this.fetchGameData(true)
              wx.showToast({ title: '新局已开启', icon: 'success' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '操作失败', icon: 'none' })
            })
        }
      }
    })
  }
})
