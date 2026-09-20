// 双人游戏大厅核心云函数（五子棋、围棋、飞行棋、海战棋）
// 经典回合制异步对战：双方轮流行动，数据持久化存储在云数据库 board_games 集合。
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')

const GOBANG_SIZE = 15
const WEIQI_SIZE = 13
const SEABATTLE_SIZE = 8
const LUDO_TRACK_LENGTH = 30

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

function createDefaultSeaShips(type = 'A') {
  if (type === 'A') {
    return [
      { id: 'ship3', name: '巡洋舰', coords: [[1, 1], [1, 2], [1, 3]], hits: 0, sunk: false },
      { id: 'ship2', name: '护卫舰', coords: [[3, 5], [4, 5]], hits: 0, sunk: false },
      { id: 'ship1', name: '潜水艇', coords: [[6, 2]], hits: 0, sunk: false }
    ]
  } else {
    return [
      { id: 'ship3', name: '巡洋舰', coords: [[2, 2], [3, 2], [4, 2]], hits: 0, sunk: false },
      { id: 'ship2', name: '护卫舰', coords: [[5, 4], [5, 5]], hits: 0, sunk: false },
      { id: 'ship1', name: '潜水艇', coords: [[1, 6]], hits: 0, sunk: false }
    ]
  }
}

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
      (g.currentTurn === 'white' && g.whiteOpenid === OPENID)
    )
    const myRole = (g.player1Openid === OPENID || g.blackOpenid === OPENID) ? 'player1' :
                   ((g.player2Openid === OPENID || g.whiteOpenid === OPENID) ? 'player2' : 'spectator')

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
      const size = gameType === 'gobang' ? GOBANG_SIZE : WEIQI_SIZE
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
      }
    } else if (gameType === 'ludo') {
      newGame = {
        ...newGame,
        trackLength: LUDO_TRACK_LENGTH,
        currentTurn: 'player1',
        player1Openid: p1Openid,
        player2Openid: p2Openid,
        player1Pos: 0,
        player2Pos: 0,
        lastDice: 0,
        lastActionLog: '游戏开始，轮到一方掷骰子',
      }
    } else if (gameType === 'seabattle') {
      newGame = {
        ...newGame,
        size: SEABATTLE_SIZE,
        currentTurn: 'player1',
        player1Openid: p1Openid,
        player2Openid: p2Openid,
        player1Ships: createDefaultSeaShips('A'),
        player2Ships: createDefaultSeaShips('B'),
        player1Attacks: createEmptyBoard(SEABATTLE_SIZE),
        player2Attacks: createEmptyBoard(SEABATTLE_SIZE),
        lastAttack: {},
        lastAttackR: -1,
        lastAttackC: -1,
        lastActionLog: '舰队就绪，轮到一方指定海域开火',
      }
    }

    const addRes = await db.collection('board_games').add({ data: newGame })
    gameDoc = { ...newGame, _id: addRes._id }
  } else {
    // 兼容历史脏数据：若历史上该文档中有 lastMove: null，通过 _.set({}) 自动修复为对象
    let needUpdate = false
    const updateData = {}
    if (gameDoc.lastMove === null) {
      updateData.lastMove = _.set({})
      needUpdate = true
    }
    if ((!gameDoc.whiteOpenid || !gameDoc.player2Openid) && partner) {
      if (partner.openid !== gameDoc.blackOpenid && partner.openid !== gameDoc.player1Openid) {
        updateData.whiteOpenid = partner.openid
        updateData.player2Openid = partner.openid
        needUpdate = true
        gameDoc.whiteOpenid = partner.openid
        gameDoc.player2Openid = partner.openid
      }
    }
    if (needUpdate) {
      updateData.updatedAt = db.serverDate()
      await db.collection('board_games').doc(gameDoc._id).update({ data: updateData })
    }
  }

  const isSolo = !partner
  let myRole = ''
  if (gameDoc.blackOpenid === OPENID || gameDoc.player1Openid === OPENID) myRole = 'player1'
  else if (gameDoc.whiteOpenid === OPENID || gameDoc.player2Openid === OPENID) myRole = 'player2'
  else if (isSolo) myRole = (gameDoc.currentTurn === 'black' || gameDoc.currentTurn === 'player1') ? 'player1' : 'player2'

  const partnerRole = myRole === 'player1' ? 'player2' : 'player1'
  const isPlaying = gameDoc.status === 'playing'
  const turnRole = (gameDoc.currentTurn === 'black' || gameDoc.currentTurn === 'player1') ? 'player1' : 'player2'
  const isMyTurn = isPlaying && (isSolo || turnRole === myRole)

  let safeGameDoc = { ...gameDoc }
  // 确保给前端的 lastMove 是有效对象
  if (!safeGameDoc.lastMove || typeof safeGameDoc.lastMove !== 'object') {
    if (safeGameDoc.lastR !== undefined && safeGameDoc.lastR >= 0) {
      safeGameDoc.lastMove = { r: safeGameDoc.lastR, c: safeGameDoc.lastC, piece: safeGameDoc.lastPiece }
    } else {
      safeGameDoc.lastMove = {}
    }
  }

  if (gameType === 'seabattle') {
    safeGameDoc = {
      ...safeGameDoc,
      myShips: myRole === 'player1' ? gameDoc.player1Ships : gameDoc.player2Ships,
      myAttacks: myRole === 'player1' ? gameDoc.player1Attacks : gameDoc.player2Attacks,
      opponentAttacks: myRole === 'player1' ? gameDoc.player2Attacks : gameDoc.player1Attacks,
    }
    delete safeGameDoc.player1Ships
    delete safeGameDoc.player2Ships
    delete safeGameDoc.player1Attacks
    delete safeGameDoc.player2Attacks
  }

  return {
    code: 0,
    data: {
      game: safeGameDoc,
      myRole: (gameType === 'gobang' || gameType === 'weiqi') ? (myRole === 'player1' ? 'black' : 'white') : myRole,
      partnerRole: (gameType === 'gobang' || gameType === 'weiqi') ? (partnerRole === 'player1' ? 'black' : 'white') : partnerRole,
      isMyTurn,
      isSolo,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar } : null
    }
  }
}

// 3. 落子动作（五子棋 & 围棋）
async function gameMove(event, ctx) {
  const { OPENID } = ctx
  const { gameId, r, c } = event
  if (r === undefined || c === undefined || !gameId) {
    throw new Error('参数错误')
  }

  const row = parseInt(r, 10)
  const col = parseInt(c, 10)
  if (isNaN(row) || isNaN(col)) throw new Error('落子坐标无效')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const res = await db.collection('board_games').doc(gameId).get()
  const game = res.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null
  const isSolo = !partner

  let myRole = ''
  if (game.blackOpenid === OPENID || game.player1Openid === OPENID) myRole = 'black'
  else if (game.whiteOpenid === OPENID || game.player2Openid === OPENID) myRole = 'white'
  else if (isSolo) myRole = game.currentTurn

  if (!myRole && !isSolo) throw new Error('您不是此对局玩家')
  if (!isSolo && game.currentTurn !== myRole) throw new Error('还没轮到你落子哦')

  const board = game.board
  const size = game.size
  if (row < 0 || row >= size || col < 0 || col >= size) throw new Error('落子位置超出棋盘')
  if (board[row][col] !== 0) throw new Error('该位置已有棋子')

  const activeTurn = isSolo ? game.currentTurn : myRole
  const piece = activeTurn === 'black' ? 1 : 2
  let updatedBoard = board
  let nextTurn = activeTurn === 'black' ? 'white' : 'black'
  let newStatus = 'playing'
  let winner = null
  let blackCaptures = game.blackCaptures || 0
  let whiteCaptures = game.whiteCaptures || 0

  if (game.gameType === 'gobang') {
    updatedBoard = board.map(rItem => [...rItem])
    updatedBoard[row][col] = piece

    const isWin = checkGobangWin(updatedBoard, row, col, piece)
    if (isWin) {
      newStatus = activeTurn === 'black' ? 'black_win' : 'white_win'
      winner = activeTurn
    } else {
      const isFull = updatedBoard.every(rItem => rItem.every(cell => cell !== 0))
      if (isFull) newStatus = 'draw'
    }
  } else if (game.gameType === 'weiqi') {
    const playRes = playWeiqiMove(board, row, col, piece)
    if (!playRes.valid) throw new Error(playRes.error || '无法在此落子')
    updatedBoard = playRes.board
    if (activeTurn === 'black') {
      blackCaptures += (playRes.capturedCount || 0)
    } else {
      whiteCaptures += (playRes.capturedCount || 0)
    }
  }

  // 关键：使用扁平字段存储坐标，同时配合 _.set(...) 彻底避免 MongoDB 将普通对象解析为嵌套点路径引发的 write error
  const lastMoveObj = { r: row, c: col, piece }
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
    updatedAt: db.serverDate(),
  }

  await db.collection('board_games').doc(gameId).update({
    data: updateData
  })

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

// 4. 飞行棋行动：掷骰子 & 战机飞行前进
async function gameRollDice(event, ctx) {
  const { OPENID } = ctx
  const { gameId } = event
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

  let myRole = ''
  if (game.player1Openid === OPENID) myRole = 'player1'
  else if (game.player2Openid === OPENID) myRole = 'player2'
  else if (isSolo) myRole = game.currentTurn

  if (!myRole && !isSolo) throw new Error('您不是此对局玩家')
  if (!isSolo && game.currentTurn !== myRole) throw new Error('还没轮到你掷骰子')

  const dice = Math.floor(Math.random() * 6) + 1
  const activeRole = isSolo ? game.currentTurn : myRole
  let p1Pos = game.player1Pos || 0
  let p2Pos = game.player2Pos || 0
  const maxTrack = game.trackLength || LUDO_TRACK_LENGTH

  let log = ''
  let newStatus = 'playing'
  let winner = null

  if (activeRole === 'player1') {
    if (p1Pos === 0) {
      if (dice >= 5) {
        p1Pos = 1
        log = `掷出 ${dice} 点！战机成功起飞进入赛道第 1 格！`
      } else {
        log = `掷出 ${dice} 点，需要 5 或 6 点才能起飞哦~`
      }
    } else {
      p1Pos += dice
      if (p1Pos >= maxTrack) {
        p1Pos = maxTrack
        newStatus = 'player1_win'
        winner = 'player1'
        log = `掷出 ${dice} 点！率先抵达终点，获得胜利！🎉`
      } else {
        log = `掷出 ${dice} 点，飞进至第 ${p1Pos} 格！`
        if (p1Pos === p2Pos && p2Pos > 0 && p2Pos < maxTrack) {
          p2Pos = 0
          log += ' ⚔️ 击落了对方战机！对方重返基地！'
        }
      }
    }
  } else {
    if (p2Pos === 0) {
      if (dice >= 5) {
        p2Pos = 1
        log = `掷出 ${dice} 点！战机成功起飞进入赛道第 1 格！`
      } else {
        log = `掷出 ${dice} 点，需要 5 或 6 点才能起飞哦~`
      }
    } else {
      p2Pos += dice
      if (p2Pos >= maxTrack) {
        p2Pos = maxTrack
        newStatus = 'player2_win'
        winner = 'player2'
        log = `掷出 ${dice} 点！率先抵达终点，获得胜利！🎉`
      } else {
        log = `掷出 ${dice} 点，飞进至第 ${p2Pos} 格！`
        if (p2Pos === p1Pos && p1Pos > 0 && p1Pos < maxTrack) {
          p1Pos = 0
          log += ' ⚔️ 击落了对方战机！对方重返基地！'
        }
      }
    }
  }

  let nextTurn = activeRole
  if (dice !== 6 || newStatus !== 'playing') {
    nextTurn = activeRole === 'player1' ? 'player2' : 'player1'
  } else {
    log += ' 🎲 掷出6点奖励再掷一次！'
  }

  const updateData = {
    player1Pos: p1Pos,
    player2Pos: p2Pos,
    lastDice: dice,
    lastActionLog: log,
    currentTurn: nextTurn,
    status: newStatus,
    winner,
    updatedAt: db.serverDate()
  }

  await db.collection('board_games').doc(gameId).update({
    data: updateData
  })

  return {
    code: 0,
    data: {
      dice,
      player1Pos: p1Pos,
      player2Pos: p2Pos,
      currentTurn: nextTurn,
      status: newStatus,
      winner,
      lastActionLog: log
    }
  }
}

// 5. 海战棋行动：指定敌方海域开火攻击
async function gameSeaAttack(event, ctx) {
  const { OPENID } = ctx
  const { gameId, r, c } = event
  if (r === undefined || c === undefined || !gameId) throw new Error('参数错误')

  const row = parseInt(r, 10)
  const col = parseInt(c, 10)
  if (isNaN(row) || isNaN(col)) throw new Error('攻击坐标无效')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const res = await db.collection('board_games').doc(gameId).get()
  const game = res.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null
  const isSolo = !partner

  let myRole = ''
  if (game.player1Openid === OPENID) myRole = 'player1'
  else if (game.player2Openid === OPENID) myRole = 'player2'
  else if (isSolo) myRole = game.currentTurn

  if (!myRole && !isSolo) throw new Error('您不是此对局玩家')
  if (!isSolo && game.currentTurn !== myRole) throw new Error('还没轮到你攻击')

  const activeRole = isSolo ? game.currentTurn : myRole
  let myAttacks = activeRole === 'player1' ? game.player1Attacks : game.player2Attacks
  let enemyShips = activeRole === 'player1' ? game.player2Ships : game.player1Ships

  if (myAttacks[row][col] !== 0) throw new Error('该海域已经炮击过啦')

  let hit = false
  let hitShipName = ''
  let allSunk = true

  const updatedShips = enemyShips.map(ship => {
    const isHitThis = ship.coords.some(([sr, sc]) => sr === row && sc === col)
    if (isHitThis) {
      hit = true
      hitShipName = ship.name
      const hits = (ship.hits || 0) + 1
      const sunk = hits >= ship.coords.length
      if (!sunk) allSunk = false
      return { ...ship, hits, sunk }
    }
    if (!ship.sunk) allSunk = false
    return ship
  })

  const updatedAttacks = myAttacks.map(rItem => [...rItem])
  updatedAttacks[row][col] = hit ? 1 : 2

  let log = hit ? `🎯 炮火命中！成功击中敌方【${hitShipName}】！` : '🌊 未击中敌舰，打入茫茫海浪中。'
  let newStatus = 'playing'
  let winner = null

  if (allSunk) {
    newStatus = activeRole === 'player1' ? 'player1_win' : 'player2_win'
    winner = activeRole
    log = '💥 敌方全部舰队已全军覆没！海战大获全胜！🏆'
  }

  const nextTurn = (hit && newStatus === 'playing') ? activeRole : (activeRole === 'player1' ? 'player2' : 'player1')
  if (hit && newStatus === 'playing') {
    log += ' 命中敌舰，获得额外连续攻击机会！'
  }

  const lastAttackObj = { r: row, c: col, hit }
  const updateData = {
    currentTurn: nextTurn,
    status: newStatus,
    winner,
    lastAttack: _.set(lastAttackObj),
    lastAttackR: row,
    lastAttackC: col,
    lastActionLog: log,
    updatedAt: db.serverDate()
  }

  if (activeRole === 'player1') {
    updateData.player1Attacks = updatedAttacks
    updateData.player2Ships = updatedShips
  } else {
    updateData.player2Attacks = updatedAttacks
    updateData.player1Ships = updatedShips
  }

  await db.collection('board_games').doc(gameId).update({
    data: updateData
  })

  return {
    code: 0,
    data: {
      hit,
      r: row,
      c: col,
      currentTurn: nextTurn,
      status: newStatus,
      winner,
      lastActionLog: log
    }
  }
}

// 6. 围棋停一手
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

// 7. 认输 / 投降
async function gameResign(event, ctx) {
  const { OPENID } = ctx
  const { gameId } = event
  if (!gameId) throw new Error('参数错误')

  const gameRes = await db.collection('board_games').doc(gameId).get()
  const game = gameRes.data
  if (!game) throw new Error('对局不存在')
  if (game.status !== 'playing') throw new Error('对局已结束')

  const isPlayer1 = (game.player1Openid === OPENID || game.blackOpenid === OPENID)
  const isPlayer2 = (game.player2Openid === OPENID || game.whiteOpenid === OPENID)
  if (!isPlayer1 && !isPlayer2) throw new Error('您不是对局玩家')

  const isBoardType = game.gameType === 'gobang' || game.gameType === 'weiqi'
  const winner = isBoardType
    ? (isPlayer1 ? 'white' : 'black')
    : (isPlayer1 ? 'player2' : 'player1')
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

// 8. 重新开始新一局
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
    nextP1 = gameDoc.player2Openid || gameDoc.whiteOpenid || OPENID
    nextP2 = gameDoc.player1Openid || gameDoc.blackOpenid || (partner ? partner.openid : '')
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
    const size = gameType === 'gobang' ? GOBANG_SIZE : WEIQI_SIZE
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
    }
  } else if (gameType === 'ludo') {
    resetData = {
      ...resetData,
      trackLength: LUDO_TRACK_LENGTH,
      currentTurn: 'player1',
      player1Pos: 0,
      player2Pos: 0,
      lastDice: 0,
      lastActionLog: '新一轮飞行棋已开启！',
    }
  } else if (gameType === 'seabattle') {
    resetData = {
      ...resetData,
      size: SEABATTLE_SIZE,
      currentTurn: 'player1',
      player1Ships: createDefaultSeaShips('A'),
      player2Ships: createDefaultSeaShips('B'),
      player1Attacks: createEmptyBoard(SEABATTLE_SIZE),
      player2Attacks: createEmptyBoard(SEABATTLE_SIZE),
      lastAttack: _.set({}),
      lastAttackR: -1,
      lastAttackC: -1,
      lastActionLog: '海域已刷新，海战棋新局开始！',
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

module.exports = {
  gameLobbyGet,
  gameGet,
  gameMove,
  gameRollDice,
  gameSeaAttack,
  gamePass,
  gameResign,
  gameReset
}
