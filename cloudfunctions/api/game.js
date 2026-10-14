// 双人游戏大厅核心云函数（五子棋、围棋、中国象棋、国际象棋）
// 经典回合制异步对战：双方轮流行动，数据持久化存储在云数据库 board_games 集合。
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')

const GOBANG_SIZE = 15
const WEIQI_SIZE = 13
const XIANGQI_ROWS = 10
const XIANGQI_COLS = 9
const CHESS_SIZE = 8

function createEmptyBoard(size) {
  const board = []
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) {
      row.push(0)
    }
    board.push(row)
  }
  return board
}

function createInitialXiangqiBoard() {
  return [
    ['b_c', 'b_m', 'b_x', 'b_s', 'b_j', 'b_s', 'b_x', 'b_m', 'b_c'],
    ['', '', '', '', '', '', '', '', ''],
    ['', 'b_p', '', '', '', '', '', 'b_p', ''],
    ['b_z', '', 'b_z', '', 'b_z', '', 'b_z', '', 'b_z'],
    ['', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['r_z', '', 'r_z', '', 'r_z', '', 'r_z', '', 'r_z'],
    ['', 'r_p', '', '', '', '', '', 'r_p', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['r_c', 'r_m', 'r_x', 'r_s', 'r_j', 'r_s', 'r_x', 'r_m', 'r_c']
  ]
}

function createInitialChessBoard() {
  return [
    ['b_r', 'b_n', 'b_b', 'b_q', 'b_k', 'b_b', 'b_n', 'b_r'],
    ['b_p', 'b_p', 'b_p', 'b_p', 'b_p', 'b_p', 'b_p', 'b_p'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['w_p', 'w_p', 'w_p', 'w_p', 'w_p', 'w_p', 'w_p', 'w_p'],
    ['w_r', 'w_n', 'w_b', 'w_q', 'w_k', 'w_b', 'w_n', 'w_r']
  ]
}

// 五子棋判定
function checkGobangWin(board, r, c, piece) {
  const size = board.length
  const row = parseInt(r, 10)
  const col = parseInt(c, 10)
  const directions = [
    [[0, 1], [0, -1]],
    [[1, 0], [-1, 0]],
    [[1, 1], [-1, -1]],
    [[1, -1], [-1, 1]]
  ]

  for (const dir of directions) {
    let count = 1
    for (const [dr, dc] of dir) {
      let currR = row + dr
      let currC = col + dc
      while (
        currR >= 0 && currR < size &&
        currC >= 0 && currC < size &&
        board[currR][currC] === piece
      ) {
        count++
        currR += dr
        currC += dc
      }
    }
    if (count >= 5) return true
  }
  return false
}

// 围棋判定
function countGroupLiberties(board, startR, startC) {
  const size = board.length
  const sR = parseInt(startR, 10)
  const sC = parseInt(startC, 10)
  const color = board[sR][sC]
  if (color === 0) return { liberties: 0, stones: [] }

  const visited = Array.from({ length: size }, () => Array(size).fill(false))
  const queue = [[sR, sC]]
  visited[sR][sC] = true

  const stones = []
  const libertiesSet = new Set()

  while (queue.length > 0) {
    const [r, c] = queue.shift()
    stones.push([r, c])

    const neighbors = [
      [r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]
    ]

    for (const [nr, nc] of neighbors) {
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
        if (board[nr][nc] === 0) {
          libertiesSet.add(`${nr},${nc}`)
        } else if (board[nr][nc] === color && !visited[nr][nc]) {
          visited[nr][nc] = true
          queue.push([nr, nc])
        }
      }
    }
  }

  return { liberties: libertiesSet.size, stones }
}

function playWeiqiMove(board, r, c, piece) {
  const size = board.length
  const row = parseInt(r, 10)
  const col = parseInt(c, 10)
  const opponent = piece === 1 ? 2 : 1
  const nextBoard = board.map(rItem => [...rItem])
  nextBoard[row][col] = piece

  let captured = []
  const neighbors = [
    [row + 1, col], [row - 1, col], [row, col + 1], [row, col - 1]
  ]

  for (const [nr, nc] of neighbors) {
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && nextBoard[nr][nc] === opponent) {
      const group = countGroupLiberties(nextBoard, nr, nc)
      if (group.liberties === 0) {
        for (const [sr, sc] of group.stones) {
          nextBoard[sr][sc] = 0
          captured.push([sr, sc])
        }
      }
    }
  }

  const myGroup = countGroupLiberties(nextBoard, row, col)
  if (myGroup.liberties === 0) {
    return { valid: false, error: '此位置无气，不能落子（禁自杀）' }
  }

  return { valid: true, board: nextBoard, capturedCount: captured.length }
}

// ================= 中国象棋走法校验 =================
function validateXiangqiMove(board, fromR, fromC, toR, toC, color) {
  if (fromR < 0 || fromR >= XIANGQI_ROWS || fromC < 0 || fromC >= XIANGQI_COLS) return false
  if (toR < 0 || toR >= XIANGQI_ROWS || toC < 0 || toC >= XIANGQI_COLS) return false
  if (fromR === toR && fromC === toC) return false

  const piece = board[fromR][fromC]
  if (!piece) return false

  const pieceColor = piece.startsWith('r_') ? 'red' : (piece.startsWith('b_') ? 'black' : '')
  if (pieceColor !== color) return false

  const targetPiece = board[toR][toC]
  if (targetPiece) {
    const targetColor = targetPiece.startsWith('r_') ? 'red' : 'black'
    if (targetColor === color) return false // 不能吃己方棋子
  }

  const type = piece.split('_')[1] // c, m, x, s, j, p, z
  const dr = toR - fromR
  const dc = toC - fromC
  const absDr = Math.abs(dr)
  const absDc = Math.abs(dc)

  // 1. 俥/車 (c)
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

  // 2. 傌/馬 (m)
  if (type === 'm') {
    if (!((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2))) return false
    // 蹩马腿判定
    if (absDr === 2) {
      const legR = fromR + (dr > 0 ? 1 : -1)
      if (board[legR][fromC]) return false
    } else {
      const legC = fromC + (dc > 0 ? 1 : -1)
      if (board[fromR][legC]) return false
    }
    return true
  }

  // 3. 相/象 (x)
  if (type === 'x') {
    if (absDr !== 2 || absDc !== 2) return false
    // 不能过河
    if (color === 'red' && toR < 5) return false
    if (color === 'black' && toR > 4) return false
    // 塞象眼
    const eyeR = fromR + dr / 2
    const eyeC = fromC + dc / 2
    if (board[eyeR][eyeC]) return false
    return true
  }

  // 4. 仕/士 (s)
  if (type === 's') {
    if (absDr !== 1 || absDc !== 1) return false
    // 九宫格限制
    if (toC < 3 || toC > 5) return false
    if (color === 'red' && (toR < 7 || toR > 9)) return false
    if (color === 'black' && (toR < 0 || toR > 2)) return false
    return true
  }

  // 5. 帥/將 (j)
  if (type === 'j') {
    // 九宫格内走一步
    if ((absDr === 1 && absDc === 0) || (absDr === 0 && absDc === 1)) {
      if (toC < 3 || toC > 5) return false
      if (color === 'red' && (toR < 7 || toR > 9)) return false
      if (color === 'black' && (toR < 0 || toR > 2)) return false
      return true
    }
    // 照面飞将规则（若对方将帅在同列无障碍，可以直接飞将吃掉）
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

  // 6. 炮/砲 (p)
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
    if (targetPiece) {
      // 吃子必须隔一个棋子
      return count === 1
    } else {
      // 走子中间不能有棋子
      return count === 0
    }
  }

  // 7. 兵/卒 (z)
  if (type === 'z') {
    if (color === 'red') {
      if (fromR >= 5) {
        // 未过河只能向前
        return dr === -1 && dc === 0
      } else {
        // 已过河可前/左/右，不可后
        return (dr === -1 && dc === 0) || (dr === 0 && absDc === 1)
      }
    } else {
      if (fromR <= 4) {
        // 未过河只能向前
        return dr === 1 && dc === 0
      } else {
        // 已过河可前/左/右，不可后
        return (dr === 1 && dc === 0) || (dr === 0 && absDc === 1)
      }
    }
  }

  return false
}

// ================= 国际象棋走法校验 =================
function validateChessMove(board, fromR, fromC, toR, toC, color) {
  if (fromR < 0 || fromR >= CHESS_SIZE || fromC < 0 || fromC >= CHESS_SIZE) return false
  if (toR < 0 || toR >= CHESS_SIZE || toC < 0 || toC >= CHESS_SIZE) return false
  if (fromR === toR && fromC === toC) return false

  const piece = board[fromR][fromC]
  if (!piece) return false

  const pieceColor = piece.startsWith('w_') ? 'white' : (piece.startsWith('b_') ? 'black' : '')
  if (pieceColor !== color) return false

  const targetPiece = board[toR][toC]
  if (targetPiece) {
    const targetColor = targetPiece.startsWith('w_') ? 'white' : 'black'
    if (targetColor === color) return false // 不能吃己方棋子
  }

  const type = piece.split('_')[1] // r, n, b, q, k, p
  const dr = toR - fromR
  const dc = toC - fromC
  const absDr = Math.abs(dr)
  const absDc = Math.abs(dc)

  // 1. 车 (Rook)
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

  // 2. 象 (Bishop)
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

  // 3. 后 (Queen)
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

  // 4. 马 (Knight)
  if (type === 'n') {
    return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2)
  }

  // 5. 王 (King)
  if (type === 'k') {
    return absDr <= 1 && absDc <= 1
  }

  // 6. 兵 (Pawn)
  if (type === 'p') {
    if (color === 'white') {
      // 必须向前 (dr < 0)
      if (dc === 0 && !targetPiece) {
        // 直进 1 格
        if (dr === -1) return true
        // 初始位 (行 6) 可直进 2 格
        if (fromR === 6 && dr === -2 && !board[5][fromC]) return true
      } else if (absDc === 1 && dr === -1 && targetPiece) {
        // 斜前方吃子
        return true
      }
    } else {
      // 黑兵必须向前 (dr > 0)
      if (dc === 0 && !targetPiece) {
        // 直进 1 格
        if (dr === 1) return true
        // 初始位 (行 1) 可直进 2 格
        if (fromR === 1 && dr === 2 && !board[2][fromC]) return true
      } else if (absDc === 1 && dr === 1 && targetPiece) {
        // 斜前方吃子
        return true
      }
    }
    return false
  }

  return false
}

// 1. 获取大厅游戏概览
async function gameLobbyGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const res = await db.collection('board_games').where({ roomId }).limit(20).get()
  const games = res.data || []

  const overview = {}
  for (const g of games) {
    const isMyTurn = g.status === 'playing' && (
      (g.currentTurn === 'player1' && g.player1Openid === OPENID) ||
      (g.currentTurn === 'player2' && g.player2Openid === OPENID) ||
      (g.currentTurn === 'black' && g.blackOpenid === OPENID) ||
      (g.currentTurn === 'white' && g.whiteOpenid === OPENID) ||
      (g.currentTurn === 'red' && (g.redOpenid === OPENID || g.player1Openid === OPENID))
    )
    const myRole = (g.player1Openid === OPENID || g.blackOpenid === OPENID || g.redOpenid === OPENID || g.whiteOpenid === OPENID) ? 'player1' :
                   ((g.player2Openid === OPENID || g.blackOpenid === OPENID) ? 'player2' : 'spectator')

    overview[g.gameType] = {
      gameId: g._id,
      status: g.status,
      currentTurn: g.currentTurn,
      isMyTurn,
      myRole,
      winner: g.winner,
      updatedAt: g.updatedAt
    }
  }

  return {
    code: 0,
    data: {
      overview,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar }
    }
  }
}

// 2. 获取指定游戏详情或自动初始化
async function gameGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const { gameType = 'gobang' } = event
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  const res = await db.collection('board_games').where({ roomId, gameType }).limit(1).get()
  let gameDoc = res.data[0]

  if (!gameDoc) {
    const p1Openid = OPENID
    const p2Openid = partner ? partner.openid : ''
    let newGame = {
      roomId,
      gameType,
      status: 'playing',
      winner: null,
      updatedAt: db.serverDate(),
      createdAt: db.serverDate(),
    }

    if (gameType === 'gobang' || gameType === 'weiqi') {
      const requestedSize = parseInt(event.size, 10)
      const validSizes = gameType === 'weiqi' ? [9, 13, 19] : [GOBANG_SIZE]
      const size = validSizes.includes(requestedSize) ? requestedSize : (gameType === 'gobang' ? GOBANG_SIZE : WEIQI_SIZE)
      newGame = {
        ...newGame,
        size,
        board: createEmptyBoard(size),
        currentTurn: 'black',
        blackOpenid: p1Openid,
        whiteOpenid: p2Openid,
        player1Openid: p1Openid,
        player2Openid: p2Openid,
        lastMove: {},
        lastR: -1,
        lastC: -1,
        lastPiece: 0,
        blackCaptures: 0,
        whiteCaptures: 0,
        consecutivePasses: 0,
        history: [],
        isFreeMode: false,
      }
    } else if (gameType === 'xiangqi') {
      newGame = {
        ...newGame,
        board: createInitialXiangqiBoard(),
        currentTurn: 'red',
        redOpenid: p1Openid,
        blackOpenid: p2Openid,
        player1Openid: p1Openid,
        player2Openid: p2Openid,
        lastMove: {},
        lastR: -1,
        lastC: -1,
        lastFromR: -1,
        lastFromC: -1,
        lastPiece: '',
        history: [],
        isFreeMode: false,
      }
    } else if (gameType === 'chess') {
      newGame = {
        ...newGame,
        board: createInitialChessBoard(),
        currentTurn: 'white',
        whiteOpenid: p1Openid,
        blackOpenid: p2Openid,
        player1Openid: p1Openid,
        player2Openid: p2Openid,
        lastMove: {},
        lastR: -1,
        lastC: -1,
        lastFromR: -1,
        lastFromC: -1,
        lastPiece: '',
        history: [],
        isFreeMode: false,
      }
    }

    const addRes = await db.collection('board_games').add({ data: newGame })
    gameDoc = { ...newGame, _id: addRes._id }
  } else {
    let needUpdate = false
    const updateData = {}
    if (gameDoc.lastMove === null) {
      updateData.lastMove = _.set({})
      needUpdate = true
    }
    if ((!gameDoc.player2Openid || !gameDoc.whiteOpenid || !gameDoc.blackOpenid) && partner) {
      if (partner.openid !== gameDoc.player1Openid) {
        updateData.player2Openid = partner.openid
        if (gameType === 'xiangqi') updateData.blackOpenid = partner.openid
        if (gameType === 'chess') updateData.blackOpenid = partner.openid
        if (gameType === 'gobang' || gameType === 'weiqi') updateData.whiteOpenid = partner.openid
        needUpdate = true
      }
    }
    if (needUpdate) {
      updateData.updatedAt = db.serverDate()
      await db.collection('board_games').doc(gameDoc._id).update({ data: updateData })
    }
  }

  const isSolo = !partner
  let myRole = ''
  if (gameDoc.player1Openid === OPENID || (gameType === 'xiangqi' ? gameDoc.redOpenid === OPENID : (gameType === 'chess' ? gameDoc.whiteOpenid === OPENID : gameDoc.blackOpenid === OPENID))) {
    myRole = 'player1'
  } else if (gameDoc.player2Openid === OPENID || (gameType === 'xiangqi' ? gameDoc.blackOpenid === OPENID : (gameType === 'chess' ? gameDoc.blackOpenid === OPENID : gameDoc.whiteOpenid === OPENID))) {
    myRole = 'player2'
  } else if (isSolo) {
    const isP1Turn = (gameDoc.currentTurn === 'black' && (gameType === 'gobang' || gameType === 'weiqi')) ||
                     (gameDoc.currentTurn === 'red' && gameType === 'xiangqi') ||
                     (gameDoc.currentTurn === 'white' && gameType === 'chess') ||
                     gameDoc.currentTurn === 'player1'
    myRole = isP1Turn ? 'player1' : 'player2'
  }

  const partnerRole = myRole === 'player1' ? 'player2' : 'player1'
  const isPlaying = gameDoc.status === 'playing'
  const isP1Turn = (gameDoc.currentTurn === 'black' && (gameType === 'gobang' || gameType === 'weiqi')) ||
                   (gameDoc.currentTurn === 'red' && gameType === 'xiangqi') ||
                   (gameDoc.currentTurn === 'white' && gameType === 'chess') ||
                   gameDoc.currentTurn === 'player1'
  const turnRole = isP1Turn ? 'player1' : 'player2'
  const isMyTurn = isPlaying && (isSolo || turnRole === myRole)

  let safeGameDoc = { ...gameDoc }
  if (!safeGameDoc.lastMove || typeof safeGameDoc.lastMove !== 'object') {
    if (safeGameDoc.lastR !== undefined && safeGameDoc.lastR >= 0) {
      safeGameDoc.lastMove = {
        r: safeGameDoc.lastR,
        c: safeGameDoc.lastC,
        fromR: safeGameDoc.lastFromR,
        fromC: safeGameDoc.lastFromC,
        piece: safeGameDoc.lastPiece
      }
    } else {
      safeGameDoc.lastMove = {}
    }
  }

  // 角色名称转换（黑白、红黑）
  let formattedMyRole = myRole
  let formattedPartnerRole = partnerRole
  if (gameType === 'gobang' || gameType === 'weiqi') {
    formattedMyRole = myRole === 'player1' ? 'black' : 'white'
    formattedPartnerRole = partnerRole === 'player1' ? 'black' : 'white'
  } else if (gameType === 'xiangqi') {
    formattedMyRole = myRole === 'player1' ? 'red' : 'black'
    formattedPartnerRole = partnerRole === 'player1' ? 'red' : 'black'
  } else if (gameType === 'chess') {
    formattedMyRole = myRole === 'player1' ? 'white' : 'black'
    formattedPartnerRole = partnerRole === 'player1' ? 'white' : 'black'
  }

  return {
    code: 0,
    data: {
      game: safeGameDoc,
      myRole: formattedMyRole,
      partnerRole: formattedPartnerRole,
      isMyTurn,
      isSolo,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar, lastActiveAt: me.lastActiveAt, networkType: me.networkType },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar, lastActiveAt: partner.lastActiveAt, networkType: partner.networkType } : null
    }
  }
}

// 3. 落子 / 走子动作（通用处理五子棋、围棋、中国象棋、国际象棋）
async function gameMove(event, ctx) {
  const { OPENID } = ctx
  const { gameId, r, c, fromR, fromC, toR, toC } = event
  if (!gameId) throw new Error('参数错误')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const res = await db.collection('board_games').doc(gameId).get()
  const game = res.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null
  const isSolo = !partner
  const gameType = game.gameType

  let myRole = ''
  if (gameType === 'gobang' || gameType === 'weiqi') {
    if (game.blackOpenid === OPENID || game.player1Openid === OPENID) myRole = 'black'
    else if (game.whiteOpenid === OPENID || game.player2Openid === OPENID) myRole = 'white'
    else if (isSolo) myRole = game.currentTurn
  } else if (gameType === 'xiangqi') {
    if (game.redOpenid === OPENID || game.player1Openid === OPENID) myRole = 'red'
    else if (game.blackOpenid === OPENID || game.player2Openid === OPENID) myRole = 'black'
    else if (isSolo) myRole = game.currentTurn
  } else if (gameType === 'chess') {
    if (game.whiteOpenid === OPENID || game.player1Openid === OPENID) myRole = 'white'
    else if (game.blackOpenid === OPENID || game.player2Openid === OPENID) myRole = 'black'
    else if (isSolo) myRole = game.currentTurn
  }

  const isFreeMode = Boolean(game.isFreeMode)

  if (!myRole && !isSolo) throw new Error('您不是此对局玩家')
  if (!isSolo && !isFreeMode && game.currentTurn !== myRole) throw new Error('还没轮到你走棋哦')

  // 自由摆棋模式下，优先使用传入的 color/piece 或根据 activeTurn，且不强行判断胜负结束
  const activeTurn = isFreeMode
    ? (event.color || (gameType === 'xiangqi' ? 'red' : (gameType === 'chess' ? 'white' : 'black')))
    : (isSolo ? game.currentTurn : myRole)
  let updatedBoard = game.board
  let nextTurn = ''
  let newStatus = 'playing'
  let winner = null
  let lastMoveObj = {}

  // 记录历史栈（支持无限悔棋，截取最近 60 步）
  const historySnapshot = {
    board: game.board,
    currentTurn: game.currentTurn,
    status: game.status,
    winner: game.winner || null,
    lastMove: game.lastMove || {},
    lastR: game.lastR !== undefined ? game.lastR : -1,
    lastC: game.lastC !== undefined ? game.lastC : -1,
    lastFromR: game.lastFromR !== undefined ? game.lastFromR : -1,
    lastFromC: game.lastFromC !== undefined ? game.lastFromC : -1,
    lastPiece: game.lastPiece || '',
    blackCaptures: game.blackCaptures || 0,
    whiteCaptures: game.whiteCaptures || 0,
    consecutivePasses: game.consecutivePasses || 0,
  }
  const currentHistory = Array.isArray(game.history) ? [...game.history] : []
  currentHistory.push(historySnapshot)
  if (currentHistory.length > 60) {
    currentHistory.shift()
  }

  // ================= 1. 五子棋 & 围棋处理 =================
  if (gameType === 'gobang' || gameType === 'weiqi') {
    const row = parseInt(r, 10)
    const col = parseInt(c, 10)
    if (isNaN(row) || isNaN(col)) throw new Error('落子坐标无效')
    const size = game.size || (gameType === 'gobang' ? GOBANG_SIZE : WEIQI_SIZE)
    if (row < 0 || row >= size || col < 0 || col >= size) throw new Error('落子位置超出棋盘')
    if (game.board[row][col] !== 0) throw new Error('该位置已有棋子')

    const piece = activeTurn === 'black' ? 1 : 2
    nextTurn = activeTurn === 'black' ? 'white' : 'black'
    let blackCaptures = game.blackCaptures || 0
    let whiteCaptures = game.whiteCaptures || 0

    if (gameType === 'gobang') {
      updatedBoard = game.board.map(rItem => [...rItem])
      updatedBoard[row][col] = piece

      const isWin = checkGobangWin(updatedBoard, row, col, piece)
      if (isWin) {
        newStatus = activeTurn === 'black' ? 'black_win' : 'white_win'
        winner = activeTurn
      } else {
        const isFull = updatedBoard.every(rItem => rItem.every(cell => cell !== 0))
        if (isFull) newStatus = 'draw'
      }
    } else {
      const playRes = playWeiqiMove(game.board, row, col, piece)
      if (!playRes.valid) throw new Error(playRes.error || '无法在此落子')
      updatedBoard = playRes.board
      if (activeTurn === 'black') {
        blackCaptures += (playRes.capturedCount || 0)
      } else {
        whiteCaptures += (playRes.capturedCount || 0)
      }
    }

    lastMoveObj = { r: row, c: col, piece }
    const updateData = {
      board: updatedBoard,
      currentTurn: nextTurn,
      status: newStatus,
      winner,
      lastMove: _.set(lastMoveObj),
      lastR: row,
      lastC: col,
      lastPiece: piece,
      consecutivePasses: 0,
      blackCaptures,
      whiteCaptures,
      history: currentHistory,
      updatedAt: db.serverDate(),
    }

    await db.collection('board_games').doc(gameId).update({ data: updateData })

    return {
      code: 0,
      data: {
        success: true,
        status: newStatus,
        winner,
        lastMove: lastMoveObj,
        currentTurn: nextTurn
      }
    }
  }

  // ================= 2. 中国象棋处理 =================
  if (gameType === 'xiangqi') {
    const fR = parseInt(fromR, 10)
    const fC = parseInt(fromC, 10)
    const tR = parseInt(toR, 10)
    const tC = parseInt(toC, 10)
    if (isNaN(fR) || isNaN(fC) || isNaN(tR) || isNaN(tC)) throw new Error('移动坐标无效')

    const isValid = isFreeMode || validateXiangqiMove(game.board, fR, fC, tR, tC, activeTurn)
    if (!isValid) throw new Error('不符合象棋走法规则')

    const movingPiece = game.board[fR][fC]
    const capturedPiece = game.board[tR][tC]

    updatedBoard = game.board.map(rItem => [...rItem])
    updatedBoard[fR][fC] = ''
    updatedBoard[tR][tC] = movingPiece

    nextTurn = activeTurn === 'red' ? 'black' : 'red'

    // 吃掉帅/将判定胜负
    if (capturedPiece === 'r_j') {
      newStatus = 'black_win'
      winner = 'black'
    } else if (capturedPiece === 'b_j') {
      newStatus = 'red_win'
      winner = 'red'
    }

    lastMoveObj = { fromR: fR, fromC: fC, toR: tR, toC: tC, piece: movingPiece, captured: capturedPiece || null }
    const updateData = {
      board: updatedBoard,
      currentTurn: nextTurn,
      status: newStatus,
      winner,
      lastMove: _.set(lastMoveObj),
      lastR: tR,
      lastC: tC,
      lastFromR: fR,
      lastFromC: fC,
      lastPiece: movingPiece,
      history: currentHistory,
      updatedAt: db.serverDate(),
    }

    await db.collection('board_games').doc(gameId).update({ data: updateData })

    return {
      code: 0,
      data: {
        success: true,
        status: newStatus,
        winner,
        lastMove: lastMoveObj,
        currentTurn: nextTurn
      }
    }
  }

  // ================= 3. 国际象棋处理 =================
  if (gameType === 'chess') {
    const fR = parseInt(fromR, 10)
    const fC = parseInt(fromC, 10)
    const tR = parseInt(toR, 10)
    const tC = parseInt(toC, 10)
    if (isNaN(fR) || isNaN(fC) || isNaN(tR) || isNaN(tC)) throw new Error('移动坐标无效')

    const isValid = isFreeMode || validateChessMove(game.board, fR, fC, tR, tC, activeTurn)
    if (!isValid) throw new Error('不符合国际象棋走法规则')

    let movingPiece = game.board[fR][fC]
    const capturedPiece = game.board[tR][tC]

    // 兵底线自动升变为后 (Queen)
    if (movingPiece === 'w_p' && tR === 0) movingPiece = 'w_q'
    if (movingPiece === 'b_p' && tR === 7) movingPiece = 'b_q'

    updatedBoard = game.board.map(rItem => [...rItem])
    updatedBoard[fR][fC] = ''
    updatedBoard[tR][tC] = movingPiece

    nextTurn = activeTurn === 'white' ? 'black' : 'white'

    // 吃掉国王判定胜负
    if (capturedPiece === 'w_k') {
      newStatus = 'black_win'
      winner = 'black'
    } else if (capturedPiece === 'b_k') {
      newStatus = 'white_win'
      winner = 'white'
    }

    lastMoveObj = { fromR: fR, fromC: fC, toR: tR, toC: tC, piece: movingPiece, captured: capturedPiece || null }
    const updateData = {
      board: updatedBoard,
      currentTurn: nextTurn,
      status: newStatus,
      winner,
      lastMove: _.set(lastMoveObj),
      lastR: tR,
      lastC: tC,
      lastFromR: fR,
      lastFromC: fC,
      lastPiece: movingPiece,
      history: currentHistory,
      updatedAt: db.serverDate(),
    }

    await db.collection('board_games').doc(gameId).update({ data: updateData })

    return {
      code: 0,
      data: {
        success: true,
        status: newStatus,
        winner,
        lastMove: lastMoveObj,
        currentTurn: nextTurn
      }
    }
  }

  throw new Error('未知游戏类型')
}

// 4. 围棋停一手
async function gamePass(event, ctx) {
  const { OPENID } = ctx
  const { gameId } = event
  if (!gameId) throw new Error('参数错误')

  const gameRes = await db.collection('board_games').doc(gameId).get()
  const game = gameRes.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const me = await getUserByOpenid(OPENID)
  const roomUsers = await getRoomUsers(me.roomId)
  const isSolo = !roomUsers.find(u => u.openid !== OPENID)

  let myRole = ''
  if (game.blackOpenid === OPENID || game.player1Openid === OPENID) myRole = 'black'
  else if (game.whiteOpenid === OPENID || game.player2Openid === OPENID) myRole = 'white'
  else if (isSolo) myRole = game.currentTurn

  if (!isSolo && game.currentTurn !== myRole) throw new Error('还没轮到你')

  const nextTurn = game.currentTurn === 'black' ? 'white' : 'black'
  const consecutivePasses = (game.consecutivePasses || 0) + 1
  let status = 'playing'
  let winner = null

  if (consecutivePasses >= 2) status = 'draw'

  const updateData = {
    currentTurn: nextTurn,
    consecutivePasses,
    status,
    winner,
    updatedAt: db.serverDate()
  }

  await db.collection('board_games').doc(gameId).update({
    data: updateData
  })

  return { code: 0, data: { status, currentTurn: nextTurn } }
}

// 5. 认输 / 投降
async function gameResign(event, ctx) {
  const { OPENID } = ctx
  const { gameId } = event
  if (!gameId) throw new Error('参数错误')

  const gameRes = await db.collection('board_games').doc(gameId).get()
  const game = gameRes.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const isPlayer1 = (game.player1Openid === OPENID || game.blackOpenid === OPENID || game.redOpenid === OPENID || game.whiteOpenid === OPENID)
  const isPlayer2 = (game.player2Openid === OPENID || game.blackOpenid === OPENID || game.whiteOpenid === OPENID)
  if (!isPlayer1 && !isPlayer2) throw new Error('您不是对局玩家')

  let winner = ''
  if (game.gameType === 'gobang' || game.gameType === 'weiqi') {
    winner = isPlayer1 ? 'white' : 'black'
  } else if (game.gameType === 'xiangqi') {
    winner = isPlayer1 ? 'black' : 'red'
  } else if (game.gameType === 'chess') {
    winner = isPlayer1 ? 'black' : 'white'
  } else {
    winner = isPlayer1 ? 'player2' : 'player1'
  }

  const status = winner + '_win'
  const updateData = {
    status,
    winner,
    updatedAt: db.serverDate()
  }

  await db.collection('board_games').doc(gameId).update({
    data: updateData
  })

  return { code: 0, data: { status, winner } }
}

// 6. 重新开始新一局
async function gameReset(event, ctx) {
  const { OPENID } = ctx
  const { gameId, gameType = 'gobang' } = event
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  let gameDoc = null
  if (gameId) {
    const res = await db.collection('board_games').doc(gameId).get()
    gameDoc = res.data
  }

  const roomId = me.roomId
  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  let nextP1 = OPENID
  let nextP2 = partner ? partner.openid : ''
  if (gameDoc) {
    nextP1 = gameDoc.player2Openid || OPENID
    nextP2 = gameDoc.player1Openid || (partner ? partner.openid : '')
  }

  let resetData = {
    roomId,
    gameType,
    status: 'playing',
    winner: null,
    player1Openid: nextP1,
    player2Openid: nextP2,
    updatedAt: db.serverDate(),
  }

  if (gameType === 'gobang' || gameType === 'weiqi') {
    const requestedSize = parseInt(event.size, 10)
    const validSizes = gameType === 'weiqi' ? [9, 13, 19] : [GOBANG_SIZE]
    let size = validSizes.includes(requestedSize) ? requestedSize : (gameDoc && gameDoc.size ? gameDoc.size : (gameType === 'gobang' ? GOBANG_SIZE : WEIQI_SIZE))
    if (!validSizes.includes(size)) size = WEIQI_SIZE

    resetData = {
      ...resetData,
      size,
      board: createEmptyBoard(size),
      currentTurn: 'black',
      blackOpenid: nextP1,
      whiteOpenid: nextP2,
      lastMove: _.set({}),
      lastR: -1,
      lastC: -1,
      lastPiece: 0,
      blackCaptures: 0,
      whiteCaptures: 0,
      consecutivePasses: 0,
      history: [],
      isFreeMode: false,
    }
  } else if (gameType === 'xiangqi') {
    resetData = {
      ...resetData,
      board: createInitialXiangqiBoard(),
      currentTurn: 'red',
      redOpenid: nextP1,
      blackOpenid: nextP2,
      lastMove: _.set({}),
      lastR: -1,
      lastC: -1,
      lastFromR: -1,
      lastFromC: -1,
      lastPiece: '',
      history: [],
      isFreeMode: false,
    }
  } else if (gameType === 'chess') {
    resetData = {
      ...resetData,
      board: createInitialChessBoard(),
      currentTurn: 'white',
      whiteOpenid: nextP1,
      blackOpenid: nextP2,
      lastMove: _.set({}),
      lastR: -1,
      lastC: -1,
      lastFromR: -1,
      lastFromC: -1,
      lastPiece: '',
      history: [],
      isFreeMode: false,
    }
  }

  if (gameDoc && gameDoc._id) {
    await db.collection('board_games').doc(gameDoc._id).update({
      data: resetData
    })
  } else {
    resetData.createdAt = db.serverDate()
    await db.collection('board_games').add({ data: resetData })
  }

  return { code: 0, data: { success: true } }
}

// 7. 悔棋（回退至上一步，无限悔棋）
async function gameUndo(event, ctx) {
  const { OPENID } = ctx
  const { gameId } = event
  if (!gameId) throw new Error('参数错误')

  const gameRes = await db.collection('board_games').doc(gameId).get()
  const game = gameRes.data
  if (!game) throw new Error('对局不存在')

  const history = Array.isArray(game.history) ? game.history : []
  if (history.length === 0) {
    throw new Error('当前没有可悔棋的步数')
  }

  const prevSnapshot = history[history.length - 1]
  const newHistory = history.slice(0, history.length - 1)

  const updateData = {
    board: prevSnapshot.board,
    currentTurn: prevSnapshot.currentTurn,
    status: prevSnapshot.status || 'playing',
    winner: prevSnapshot.winner || null,
    lastMove: _.set(prevSnapshot.lastMove || {}),
    lastR: prevSnapshot.lastR !== undefined ? prevSnapshot.lastR : -1,
    lastC: prevSnapshot.lastC !== undefined ? prevSnapshot.lastC : -1,
    lastFromR: prevSnapshot.lastFromR !== undefined ? prevSnapshot.lastFromR : -1,
    lastFromC: prevSnapshot.lastFromC !== undefined ? prevSnapshot.lastFromC : -1,
    lastPiece: prevSnapshot.lastPiece || '',
    blackCaptures: prevSnapshot.blackCaptures || 0,
    whiteCaptures: prevSnapshot.whiteCaptures || 0,
    consecutivePasses: prevSnapshot.consecutivePasses || 0,
    history: newHistory,
    updatedAt: db.serverDate(),
  }

  await db.collection('board_games').doc(gameId).update({ data: updateData })

  return { code: 0, data: { success: true, remainingUndos: newHistory.length } }
}

// 8. 切换摆棋（自由研究）模式
async function gameToggleFreeMode(event, ctx) {
  const { OPENID } = ctx
  const { gameId, enable } = event
  if (!gameId) throw new Error('参数错误')

  const gameRes = await db.collection('board_games').doc(gameId).get()
  const game = gameRes.data
  if (!game) throw new Error('对局不存在')

  const isFreeMode = typeof enable === 'boolean' ? enable : !game.isFreeMode
  await db.collection('board_games').doc(gameId).update({
    data: {
      isFreeMode,
      updatedAt: db.serverDate(),
    }
  })

  return { code: 0, data: { success: true, isFreeMode } }
}

module.exports = {
  gameLobbyGet,
  gameGet,
  gameMove,
  gamePass,
  gameResign,
  gameReset,
  gameUndo,
  gameToggleFreeMode
}
