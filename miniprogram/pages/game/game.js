// 游戏大厅（选定游戏列表 & 四大经典对战：五子棋、围棋、中国象棋、国际象棋）页面逻辑
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')

const GOBANG_STAR_POINTS = [
  { r: 3, c: 3 }, { r: 3, c: 11 },
  { r: 7, c: 7 },
  { r: 11, c: 3 }, { r: 11, c: 11 }
]

const WEIQI_STAR_POINTS_MAP = {
  9: [
    { r: 2, c: 2 }, { r: 2, c: 6 },
    { r: 4, c: 4 },
    { r: 6, c: 2 }, { r: 6, c: 6 }
  ],
  13: [
    { r: 3, c: 3 }, { r: 3, c: 9 },
    { r: 6, c: 6 },
    { r: 9, c: 3 }, { r: 9, c: 9 }
  ],
  19: [
    { r: 3, c: 3 }, { r: 3, c: 9 }, { r: 3, c: 15 },
    { r: 9, c: 3 }, { r: 9, c: 9 }, { r: 9, c: 15 },
    { r: 15, c: 3 }, { r: 15, c: 9 }, { r: 15, c: 15 }
  ]
}

const WEIQI_STAR_POINTS = WEIQI_STAR_POINTS_MAP[13]

const GAME_META = {
  gobang: { title: '五子棋', emoji: '⚪⚫' },
  weiqi: { title: '围棋', emoji: '☯️' },
  xiangqi: { title: '中国象棋', emoji: '🏮' },
  chess: { title: '国际象棋', emoji: '♚' },
}

const XIANGQI_PIECE_MAP = {
  r_c: '俥', r_m: '傌', r_x: '相', r_s: '仕', r_j: '帥', r_p: '炮', r_z: '兵',
  b_c: '車', b_m: '馬', b_x: '象', b_s: '士', b_j: '將', b_p: '砲', b_z: '卒'
}

const CHESS_PIECE_MAP = {
  w_r: '♖', w_n: '♘', w_b: '♗', w_q: '♕', w_k: '♔', w_p: '♙',
  b_r: '♜', b_n: '♞', b_b: '♝', b_q: '♛', b_k: '♚', b_p: '♟'
}

// 格式化渲染棋盘数据：为每个格子预先准备好属性（字符、颜色、是否为己方等），确保WXML无需依赖复杂表达式
function formatDisplayBoard(board, gameType) {
  if (!board || !Array.isArray(board)) return []
  if (gameType === 'xiangqi') {
    return board.map((row, r) => row.map((cell, c) => {
      if (!cell) return null
      return {
        key: cell,
        char: XIANGQI_PIECE_MAP[cell] || '',
        isRed: cell.startsWith('r_'),
        r,
        c
      }
    }))
  }
  if (gameType === 'chess') {
    return board.map((row, r) => row.map((cell, c) => {
      if (!cell) return null
      return {
        key: cell,
        char: CHESS_PIECE_MAP[cell] || '',
        isWhite: cell.startsWith('w_'),
        r,
        c
      }
    }))
  }
  return board
}

Page({
  data: {
    currentView: 'lobby', // 'lobby' | 'play'
    currentGameType: 'gobang',
    gameMeta: GAME_META.gobang,

    lobbyStatus: {
      gobang: { statusText: '点击开始对弈', isMyTurn: false },
      weiqi: { statusText: '点击开始对弈', isMyTurn: false },
      xiangqi: { statusText: '点击开始对弈', isMyTurn: false },
      chess: { statusText: '点击开始对弈', isMyTurn: false },
    },

    // 棋类状态 (五子棋 & 围棋)
    boardSize: 15,
    starPoints: GOBANG_STAR_POINTS,
    board: [],
    displayBoard: [], // 格式化后的用于视图渲染的棋盘

    // 围棋路数切换
    weiqiSizes: [9, 13, 19],

    // 选点与微调移动 (五子棋 & 围棋准星)
    cursorPos: null, // { r, c }

    // 摆棋模式
    isFreeMode: false,
    freePieceColor: 'black', // 'black' | 'white' (摆棋时当前落子颜色)

    // 辅助行与列数组，确保 WXML 能够稳定进行循环
    xqRows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    xqCols: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    chessCells: [0, 1, 2, 3, 4, 5, 6, 7],

    // 选子与走子状态 (中国象棋 & 国际象棋)
    selectedPos: null, // { r, c }
    validMoves: [],    // [{ r, c, isCapture }]

    // 通用对局信息
    game: null,
    myRole: '',
    partnerRole: '',
    isP1: false,
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
    const { blackUser, whiteUser, isP1, isSolo } = this.data
    const isMeP1 = Boolean(isP1)
    const isMeP2 = !isP1 && !isSolo

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

    let turnRole = 'player1'
    if (currentGameType === 'xiangqi') {
      turnRole = doc.currentTurn === 'red' ? 'player1' : 'player2'
    } else if (currentGameType === 'chess') {
      turnRole = doc.currentTurn === 'white' ? 'player1' : 'player2'
    } else {
      turnRole = (doc.currentTurn === 'black' || doc.currentTurn === 'player1') ? 'player1' : 'player2'
    }

    const isMyTurn = isPlaying && (this.data.isSolo || turnRole === (myRole === 'player1' || myRole === 'red' || myRole === 'white' || (myRole === 'black' && currentGameType !== 'xiangqi' && currentGameType !== 'chess') ? 'player1' : 'player2'))

    const isP1Turn = (doc.currentTurn === 'black' && (currentGameType === 'gobang' || currentGameType === 'weiqi')) ||
                     (doc.currentTurn === 'red' && currentGameType === 'xiangqi') ||
                     (doc.currentTurn === 'white' && currentGameType === 'chess') ||
                     doc.currentTurn === 'player1'
    const isP2Turn = !isP1Turn

    const isWon = (doc.status === 'black_win' && (myRole === 'black')) ||
                  (doc.status === 'white_win' && (myRole === 'white')) ||
                  (doc.status === 'red_win' && (myRole === 'red')) ||
                  (doc.status === 'player1_win' && myRole === 'player1') ||
                  (doc.status === 'player2_win' && myRole === 'player2')

    let safeDoc = { ...doc }
    if (!safeDoc.lastMove || typeof safeDoc.lastMove !== 'object') {
      if (safeDoc.lastR !== undefined && safeDoc.lastR >= 0) {
        safeDoc.lastMove = {
          r: safeDoc.lastR,
          c: safeDoc.lastC,
          fromR: safeDoc.lastFromR,
          fromC: safeDoc.lastFromC,
          piece: safeDoc.lastPiece
        }
      } else {
        safeDoc.lastMove = {}
      }
    }

    const newBoard = safeDoc.board || this.data.board
    const displayBoard = formatDisplayBoard(newBoard, currentGameType)

    // 适配围棋动态路数
    let boardSize = this.data.boardSize
    let starPoints = this.data.starPoints
    if (currentGameType === 'weiqi' && safeDoc.size && safeDoc.size !== boardSize) {
      boardSize = safeDoc.size
      starPoints = WEIQI_STAR_POINTS_MAP[boardSize] || WEIQI_STAR_POINTS_MAP[13]
    }

    const nextData = {
      game: safeDoc,
      board: newBoard,
      displayBoard,
      boardSize,
      starPoints,
      isFreeMode: Boolean(safeDoc.isFreeMode),
      isMyTurn: Boolean(safeDoc.isFreeMode) || isMyTurn,
      isP1Turn,
      isP2Turn,
      isWon,
      selectedPos: null,
      validMoves: []
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
          gobang: this._formatLobbyItem(overview.gobang, 'gobang'),
          weiqi: this._formatLobbyItem(overview.weiqi, 'weiqi'),
          xiangqi: this._formatLobbyItem(overview.xiangqi, 'xiangqi'),
          chess: this._formatLobbyItem(overview.chess, 'chess'),
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
      const myWon = (item.status === 'red_win' && (item.myRole === 'player1' || item.myRole === 'red')) ||
                    (item.status === 'white_win' && (item.myRole === 'player1' || item.myRole === 'white')) ||
                    (item.status === 'black_win' && (item.myRole === 'player2' || item.myRole === 'black'))
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
      gameMeta: GAME_META[gameType] || GAME_META.gobang,
      selectedPos: null,
      validMoves: []
    })
    this.initBoardConfig(gameType)
    this.fetchGameData()
  },

  // 3. 返回大厅
  backToLobby() {
    this._stopGameWatcher()
    this.setData({ currentView: 'lobby', selectedPos: null, validMoves: [] })
    this.fetchLobbyOverview(true)
  },

  initBoardConfig(type, size) {
    if (type === 'gobang') {
      this.setData({ boardSize: 15, starPoints: GOBANG_STAR_POINTS, cursorPos: null })
    } else if (type === 'weiqi') {
      const s = size || 13
      this.setData({
        boardSize: s,
        starPoints: WEIQI_STAR_POINTS_MAP[s] || WEIQI_STAR_POINTS_MAP[13],
        cursorPos: null
      })
    }
  },

  // 4. 获取游戏详情
  fetchGameData(quiet = false) {
    if (!quiet) wx.showLoading({ title: '加载中...' })
    return api.call('gameGet', { gameType: this.data.currentGameType })
      .then(res => {
        if (!res) return
        const { game, myRole, partnerRole, isMyTurn, isSolo, me, partner } = res
        const { currentGameType } = this.data

        const isP1 = (myRole === 'black' && (currentGameType === 'gobang' || currentGameType === 'weiqi')) ||
                     (myRole === 'red' && currentGameType === 'xiangqi') ||
                     (myRole === 'white' && currentGameType === 'chess') ||
                     (myRole === 'player1')
        const blackUser = isP1 ? me : (partner || {})
        const whiteUser = isP1 ? (partner || {}) : me

        const isP1Turn = (game.currentTurn === 'black' && (currentGameType === 'gobang' || currentGameType === 'weiqi')) ||
                         (game.currentTurn === 'red' && currentGameType === 'xiangqi') ||
                         (game.currentTurn === 'white' && currentGameType === 'chess') ||
                         game.currentTurn === 'player1'
        const isP2Turn = !isP1Turn

        const isWon = (game.status === 'black_win' && myRole === 'black') ||
                      (game.status === 'white_win' && myRole === 'white') ||
                      (game.status === 'red_win' && myRole === 'red') ||
                      (game.status === 'player1_win' && myRole === 'player1') ||
                      (game.status === 'player2_win' && myRole === 'player2')

        const rawBoard = game.board || []
        const displayBoard = formatDisplayBoard(rawBoard, currentGameType)

        let boardSize = this.data.boardSize
        let starPoints = this.data.starPoints
        if (currentGameType === 'weiqi' && game.size) {
          boardSize = game.size
          starPoints = WEIQI_STAR_POINTS_MAP[boardSize] || WEIQI_STAR_POINTS_MAP[13]
        }

        this.setData({
          game,
          board: rawBoard,
          displayBoard,
          boardSize,
          starPoints,
          isFreeMode: Boolean(game.isFreeMode),
          myRole,
          partnerRole,
          isP1,
          isMyTurn: Boolean(game.isFreeMode) || isMyTurn,
          isP1Turn,
          isP2Turn,
          isWon,
          isSolo: Boolean(isSolo),
          blackUser,
          whiteUser,
          selectedPos: null,
          validMoves: []
        })
        this.updateNoticeText()
        this._updateBothNetworkStatus()
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
    const { game, isMyTurn, isSolo, currentGameType, isWon, selectedPos } = this.data
    if (!game) return

    if (game.status === 'playing') {
      if (this.data.isFreeMode) {
        this.setData({ turnNoticeText: '摆棋模式 · 双方可自由落子与演练' })
      } else if (isMyTurn) {
        if (isSolo) {
          this.setData({ turnNoticeText: '单人演练模式，轮到当前角色行动' })
        } else if (currentGameType === 'gobang' || currentGameType === 'weiqi') {
          this.setData({ turnNoticeText: '轮到你落子，点击或移动准星落棋' })
        } else if (currentGameType === 'xiangqi') {
          this.setData({ turnNoticeText: selectedPos ? '已选定棋子，点击目标点走棋' : '轮到你走棋，请先点击己方棋子' })
        } else if (currentGameType === 'chess') {
          this.setData({ turnNoticeText: selectedPos ? '已选定棋子，点击目标格走棋' : '轮到你走棋，请先点击己方棋子' })
        }
      } else {
        this.setData({ turnNoticeText: '对方思考中，对局实时同步中…' })
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

  // 5. 五子棋 / 围棋点击交叉点（支持准星瞄准与确认落子）
  onCellTap(e) {
    const { r, c } = e.currentTarget.dataset
    const row = parseInt(r, 10)
    const col = parseInt(c, 10)
    const { cursorPos, isMyTurn } = this.data

    if (!isMyTurn) {
      wx.showToast({ title: '还没轮到你落子哦', icon: 'none' })
      return
    }

    // 若已经有准星，且再次点击准星所在交叉点，则直接执行落子
    if (cursorPos && cursorPos.r === row && cursorPos.c === col) {
      this.confirmDropPiece()
    } else {
      // 移动准星到该交叉点
      try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
      this.setData({ cursorPos: { r: row, c: col } })
    }
  },

  // 移动准星 (支持上下左右微调选点)
  onMoveCursor(e) {
    const { dr, dc } = e.currentTarget.dataset
    const deltaR = parseInt(dr, 10) || 0
    const deltaC = parseInt(dc, 10) || 0
    const { boardSize, cursorPos } = this.data

    let curR = cursorPos ? cursorPos.r : Math.floor(boardSize / 2)
    let curC = cursorPos ? cursorPos.c : Math.floor(boardSize / 2)

    let nextR = Math.max(0, Math.min(boardSize - 1, curR + deltaR))
    let nextC = Math.max(0, Math.min(boardSize - 1, curC + deltaC))

    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    this.setData({ cursorPos: { r: nextR, c: nextC } })
  },

  // 取消准星选择
  onCancelCursor() {
    this.setData({ cursorPos: null })
  },

  // 切换摆棋落子颜色
  onToggleFreePieceColor() {
    const nextColor = this.data.freePieceColor === 'black' ? 'white' : 'black'
    this.setData({ freePieceColor: nextColor })
    wx.showToast({ title: nextColor === 'black' ? '执黑子' : '执白子', icon: 'none' })
  },

  // 确认在此准星点落子
  confirmDropPiece() {
    const { cursorPos, game, isMyTurn, board, submitting, isFreeMode, freePieceColor } = this.data
    if (!cursorPos) return
    const { r: row, c: col } = cursorPos

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

    const movePayload = {
      gameId: game._id,
      r: row,
      c: col
    }
    if (isFreeMode) {
      movePayload.color = freePieceColor
    }

    api.call('gameMove', movePayload)
      .then(res => {
        wx.hideLoading()
        try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
        this.setData({ cursorPos: null })
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

  // ================= 中国象棋与国际象棋交互 =================
  onPieceOrCellTap(e) {
    const { r, c } = e.currentTarget.dataset
    const row = parseInt(r, 10)
    const col = parseInt(c, 10)
    const { game, isMyTurn, myRole, board, currentGameType, selectedPos, validMoves, submitting } = this.data

    if (submitting) return
    if (!game || game.status !== 'playing') {
      wx.showToast({ title: '对局已结束，请新开一局', icon: 'none' })
      return
    }
    if (!isMyTurn) {
      wx.showToast({ title: '还没轮到你走棋哦', icon: 'none' })
      return
    }

    const clickedPiece = board[row] && board[row][col]
    const isRed = currentGameType === 'xiangqi' && clickedPiece && clickedPiece.startsWith('r_')
    const isBlackXQ = currentGameType === 'xiangqi' && clickedPiece && clickedPiece.startsWith('b_')
    const isWhiteChess = currentGameType === 'chess' && clickedPiece && clickedPiece.startsWith('w_')
    const isBlackChess = currentGameType === 'chess' && clickedPiece && clickedPiece.startsWith('b_')

    const isMyPiece = (myRole === 'red' && isRed) ||
                      (myRole === 'black' && (isBlackXQ || isBlackChess)) ||
                      (myRole === 'white' && isWhiteChess) ||
                      ((this.data.isSolo || this.data.isFreeMode) && clickedPiece) // 单人演练或摆棋模式可操控任一方

    // 1. 如果点击了合法移动落点 -> 执行走子
    const matchedMove = validMoves.find(m => m.r === row && m.c === col)
    if (selectedPos && matchedMove) {
      this._executeChessMove(selectedPos.r, selectedPos.c, row, col)
      return
    }

    // 摆棋模式下，若点击了任意非己方或空位格子，也允许自由挪动
    if (selectedPos && this.data.isFreeMode && !(selectedPos.r === row && selectedPos.c === col)) {
      this._executeChessMove(selectedPos.r, selectedPos.c, row, col)
      return
    }

    // 2. 如果点击了已选中的棋子 -> 取消选中
    if (selectedPos && selectedPos.r === row && selectedPos.c === col) {
      this.setData({ selectedPos: null, validMoves: [] })
      this.updateNoticeText()
      return
    }

    // 3. 如果点击了己方棋子 -> 选中并计算合法走位
    if (isMyPiece) {
      try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
      const activeColor = this.data.isSolo ? (
        clickedPiece.startsWith('r_') ? 'red' :
        clickedPiece.startsWith('b_') ? 'black' :
        clickedPiece.startsWith('w_') ? 'white' : 'black'
      ) : myRole

      const moves = this._calculateValidMoves(row, col, activeColor)
      this.setData({
        selectedPos: { r: row, c: col },
        validMoves: moves
      })
      this.updateNoticeText()
      return
    }

    // 4. 点击了其他空白处或不可达点 -> 取消选中
    if (selectedPos) {
      this.setData({ selectedPos: null, validMoves: [] })
      this.updateNoticeText()
    }
  },

  _executeChessMove(fromR, fromC, toR, toC) {
    const { game } = this.data
    this.setData({ submitting: true })
    wx.showLoading({ title: '走棋中...' })
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}

    api.call('gameMove', {
      gameId: game._id,
      fromR,
      fromC,
      toR,
      toC
    })
      .then(res => {
        wx.hideLoading()
        this.setData({ selectedPos: null, validMoves: [] })
        this.fetchGameData(true)
        if (res && res.winner) {
          wx.showModal({
            title: '对局结束',
            content: res.winner === this.data.myRole ? '🎉 棋高一着！你赢下了这一局！' : 'TA赢得了本局对弈~',
            showCancel: false,
          })
        }
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '走棋失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  },

  _calculateValidMoves(r, c, color) {
    const { currentGameType, board } = this.data
    const moves = []
    if (currentGameType === 'xiangqi') {
      for (let tr = 0; tr < 10; tr++) {
        for (let tc = 0; tc < 9; tc++) {
          if (this._checkXiangqiRule(board, r, c, tr, tc, color)) {
            moves.push({ r: tr, c: tc, isCapture: Boolean(board[tr][tc]) })
          }
        }
      }
    } else if (currentGameType === 'chess') {
      for (let tr = 0; tr < 8; tr++) {
        for (let tc = 0; tc < 8; tc++) {
          if (this._checkChessRule(board, r, c, tr, tc, color)) {
            moves.push({ r: tr, c: tc, isCapture: Boolean(board[tr][tc]) })
          }
        }
      }
    }
    return moves
  },

  _checkXiangqiRule(board, fromR, fromC, toR, toC, color) {
    if (fromR === toR && fromC === toC) return false
    const piece = board[fromR][fromC]
    if (!piece) return false

    const targetPiece = board[toR][toC]
    if (targetPiece) {
      const targetColor = targetPiece.startsWith('r_') ? 'red' : 'black'
      if (targetColor === color) return false
    }

    const type = piece.split('_')[1]
    const dr = toR - fromR
    const dc = toC - fromC
    const absDr = Math.abs(dr)
    const absDc = Math.abs(dc)

    if (type === 'c') {
      if (fromR !== toR && fromC !== toC) return false
      if (fromR === toR) {
        const minC = Math.min(fromC, toC)
        const maxC = Math.max(fromC, toC)
        for (let c = minC + 1; c < maxC; c++) {
          if (board[fromR][c]) return false
        }
      } else {
        const minR = Math.min(fromR, toR)
        const maxR = Math.max(fromR, toR)
        for (let r = minR + 1; r < maxR; r++) {
          if (board[r][fromC]) return false
        }
      }
      return true
    }

    if (type === 'm') {
      if (!((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2))) return false
      if (absDr === 2) {
        const legR = fromR + (dr > 0 ? 1 : -1)
        if (board[legR][fromC]) return false
      } else {
        const legC = fromC + (dc > 0 ? 1 : -1)
        if (board[fromR][legC]) return false
      }
      return true
    }

    if (type === 'x') {
      if (absDr !== 2 || absDc !== 2) return false
      if (color === 'red' && toR < 5) return false
      if (color === 'black' && toR > 4) return false
      const eyeR = fromR + dr / 2
      const eyeC = fromC + dc / 2
      if (board[eyeR][eyeC]) return false
      return true
    }

    if (type === 's') {
      if (absDr !== 1 || absDc !== 1) return false
      if (toC < 3 || toC > 5) return false
      if (color === 'red' && (toR < 7 || toR > 9)) return false
      if (color === 'black' && (toR < 0 || toR > 2)) return false
      return true
    }

    if (type === 'j') {
      if ((absDr === 1 && absDc === 0) || (absDr === 0 && absDc === 1)) {
        if (toC < 3 || toC > 5) return false
        if (color === 'red' && (toR < 7 || toR > 9)) return false
        if (color === 'black' && (toR < 0 || toR > 2)) return false
        return true
      }
      if (absDc === 0 && targetPiece && (targetPiece === 'r_j' || targetPiece === 'b_j')) {
        const minR = Math.min(fromR, toR)
        const maxR = Math.max(fromR, toR)
        for (let r = minR + 1; r < maxR; r++) {
          if (board[r][fromC]) return false
        }
        return true
      }
      return false
    }

    if (type === 'p') {
      if (fromR !== toR && fromC !== toC) return false
      let count = 0
      if (fromR === toR) {
        const minC = Math.min(fromC, toC)
        const maxC = Math.max(fromC, toC)
        for (let c = minC + 1; c < maxC; c++) {
          if (board[fromR][c]) count++
        }
      } else {
        const minR = Math.min(fromR, toR)
        const maxR = Math.max(fromR, toR)
        for (let r = minR + 1; r < maxR; r++) {
          if (board[r][fromC]) count++
        }
      }
      return targetPiece ? count === 1 : count === 0
    }

    if (type === 'z') {
      if (color === 'red') {
        if (fromR >= 5) return dr === -1 && dc === 0
        return (dr === -1 && dc === 0) || (dr === 0 && absDc === 1)
      } else {
        if (fromR <= 4) return dr === 1 && dc === 0
        return (dr === 1 && dc === 0) || (dr === 0 && absDc === 1)
      }
    }

    return false
  },

  _checkChessRule(board, fromR, fromC, toR, toC, color) {
    if (fromR === toR && fromC === toC) return false
    const piece = board[fromR][fromC]
    if (!piece) return false

    const targetPiece = board[toR][toC]
    if (targetPiece) {
      const targetColor = targetPiece.startsWith('w_') ? 'white' : 'black'
      if (targetColor === color) return false
    }

    const type = piece.split('_')[1]
    const dr = toR - fromR
    const dc = toC - fromC
    const absDr = Math.abs(dr)
    const absDc = Math.abs(dc)

    if (type === 'r') {
      if (fromR !== toR && fromC !== toC) return false
      if (fromR === toR) {
        const minC = Math.min(fromC, toC)
        const maxC = Math.max(fromC, toC)
        for (let c = minC + 1; c < maxC; c++) {
          if (board[fromR][c]) return false
        }
      } else {
        const minR = Math.min(fromR, toR)
        const maxR = Math.max(fromR, toR)
        for (let r = minR + 1; r < maxR; r++) {
          if (board[r][fromC]) return false
        }
      }
      return true
    }

    if (type === 'b') {
      if (absDr !== absDc) return false
      const stepR = dr > 0 ? 1 : -1
      const stepC = dc > 0 ? 1 : -1
      let currR = fromR + stepR
      let currC = fromC + stepC
      while (currR !== toR && currC !== toC) {
        if (board[currR][currC]) return false
        currR += stepR
        currC += stepC
      }
      return true
    }

    if (type === 'q') {
      if (fromR === toR || fromC === toC) {
        if (fromR === toR) {
          const minC = Math.min(fromC, toC)
          const maxC = Math.max(fromC, toC)
          for (let c = minC + 1; c < maxC; c++) {
            if (board[fromR][c]) return false
          }
        } else {
          const minR = Math.min(fromR, toR)
          const maxR = Math.max(fromR, toR)
          for (let r = minR + 1; r < maxR; r++) {
            if (board[r][fromC]) return false
          }
        }
        return true
      } else if (absDr === absDc) {
        const stepR = dr > 0 ? 1 : -1
        const stepC = dc > 0 ? 1 : -1
        let currR = fromR + stepR
        let currC = fromC + stepC
        while (currR !== toR && currC !== toC) {
          if (board[currR][currC]) return false
          currR += stepR
          currC += stepC
        }
        return true
      }
      return false
    }

    if (type === 'n') {
      return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)
    }

    if (type === 'k') {
      return absDr <= 1 && absDc <= 1
    }

    if (type === 'p') {
      if (color === 'white') {
        if (dc === 0 && !targetPiece) {
          if (dr === -1) return true
          if (fromR === 6 && dr === -2 && !board[5][fromC]) return true
        } else if (absDc === 1 && dr === -1 && targetPiece) {
          return true
        }
      } else {
        if (dc === 0 && !targetPiece) {
          if (dr === 1) return true
          if (fromR === 1 && dr === 2 && !board[2][fromC]) return true
        } else if (absDc === 1 && dr === 1 && targetPiece) {
          return true
        }
      }
      return false
    }

    return false
  },

  // 6. 围棋停一手
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

  // 7. 认输
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

  // 8. 悔棋（无限悔棋）
  onUndo() {
    const { game } = this.data
    if (!game || !game._id) return

    if (!game.history || game.history.length === 0) {
      wx.showToast({ title: '当前无可悔步数', icon: 'none' })
      return
    }

    wx.showModal({
      title: '悔棋确认',
      content: '确定要回退至上一回合吗？',
      confirmText: '确定悔棋',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在回退...' })
          api.call('gameUndo', { gameId: game._id })
            .then(() => {
              wx.hideLoading()
              try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
              this.setData({ selectedPos: null, validMoves: [], cursorPos: null })
              this.fetchGameData(true)
              wx.showToast({ title: '已撤回一步', icon: 'success' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '悔棋失败', icon: 'none' })
            })
        }
      }
    })
  },

  // 9. 切换摆棋（自由落子）模式
  onToggleFreeMode() {
    const { game, isFreeMode } = this.data
    if (!game || !game._id) return

    const targetMode = !isFreeMode
    wx.showLoading({ title: targetMode ? '切换摆棋...' : '切换对战...' })
    api.call('gameToggleFreeMode', {
      gameId: game._id,
      enable: targetMode
    })
      .then(() => {
        wx.hideLoading()
        this.fetchGameData(true)
        wx.showToast({
          title: targetMode ? '已开启摆棋模式' : '已返回正常对战',
          icon: 'none'
        })
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '切换失败', icon: 'none' })
      })
  },

  // 10. 围棋选择路数
  onSelectWeiqiSize(e) {
    const size = parseInt(e.currentTarget.dataset.size, 10)
    const { game, currentGameType, boardSize } = this.data
    if (size === boardSize) return

    wx.showModal({
      title: '切换棋盘路数',
      content: `确定切换为 ${size} 路棋盘吗？将重置当前对局。`,
      confirmText: '确定切换',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '重置棋盘中...' })
          api.call('gameReset', {
            gameId: game ? game._id : undefined,
            gameType: currentGameType,
            size
          })
            .then(() => {
              wx.hideLoading()
              this.initBoardConfig('weiqi', size)
              this.setData({ selectedPos: null, validMoves: [], cursorPos: null })
              this.fetchGameData(true)
              wx.showToast({ title: `已设为${size}路`, icon: 'success' })
            })
            .catch(err => {
              wx.hideLoading()
              wx.showToast({ title: err.message || '设置失败', icon: 'none' })
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

  // 11. 重开
  onResetGame() {
    const { game, currentGameType, boardSize } = this.data
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
            gameType: currentGameType,
            size: currentGameType === 'weiqi' ? boardSize : undefined
          })
            .then(() => {
              wx.hideLoading()
              this.setData({ selectedPos: null, validMoves: [], cursorPos: null })
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
