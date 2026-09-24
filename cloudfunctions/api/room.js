// 房间与档案：登录自动建档/自动入住 + 邀请加入 + 改资料
// 一个账号（openid）永久绑定一个房间，无创建/加入/切换/退出入口。
const { db, _, getUserByOpenid, getRoomUsers, getRoomById } = require('./helpers')
const { record } = require('./transactions')

// 首次自动建档默认值（可在「我」页面修改昵称）
const DEFAULT_HOST_NICKNAME = '宝宝'
const DEFAULT_GUEST_NICKNAME = '贝贝'
const DEFAULT_ROOM_NAME = '我们的家'

// 返回给前端的成员列表去掉密码字段
function publicUser(u) {
  const { password, ...rest } = u || {}
  return rest
}
// 返回给前端的房间文档去掉密码字段
function publicRoom(r) {
  if (!r) return null
  const { password, ...rest } = r
  return rest
}

// 创建房间，返回 roomId
async function createRoomDoc(name, hostOpenid) {
  const addRes = await db.collection('rooms').add({
    data: {
      name: String(name || DEFAULT_ROOM_NAME).slice(0, 20),
      password: '',
      hostOpenid: hostOpenid || '',
      createdAt: db.serverDate(),
    },
  })
  return addRes._id
}

// 创建用户档案并入住房间（首次建档），返回带 _id 的 me 文档
async function createUserDoc(openid, nickname, avatar, roomId, host) {
  const user = {
    openid,
    nickname: String(nickname || '').slice(0, 8),
    avatar: avatar || '😊',
    balance: 100,
    totalEarned: 100,
    roomId,
    host,
    createdAt: db.serverDate(),
  }
  const userRes = await db.collection('users').add({ data: user })
  user._id = userRes._id
  await record({
    roomId,
    fromUser: '🏠 爱神', fromOpenid: 'system',
    toUser: user.nickname, toOpenid: openid,
    amount: 100, type: 'reward', reason: host ? '入住小窝 · 初始积分' : '加入小窝 · 初始积分',
  })
  return user
}

// ============ 登录/获取档案（无档案则自动建档 + 自动创建房间） ============
async function login(event, ctx) {
  const { OPENID } = ctx
  let me = await getUserByOpenid(OPENID)

  if (!me) {
    // 首次登录：自动建档并创建属于自己的房间
    const nickname = String(event.nickname || '').trim() || DEFAULT_HOST_NICKNAME
    const roomId = await createRoomDoc(String(event.roomName || '').trim(), OPENID)
    me = await createUserDoc(OPENID, nickname, event.avatar, roomId, true)
  } else if (!me.roomId) {
    // 有档案但还没房间（历史遗留数据）：补建房间并入住
    const roomId = await createRoomDoc(DEFAULT_ROOM_NAME, OPENID)
    await db.collection('users').doc(me._id).update({ data: { roomId, host: true } })
    me = await getUserByOpenid(OPENID)
  }

  // 兼容旧数据：若 roomId 不是有效的 rooms 文档 _id，自动迁移
  let roomDoc = null
  try {
    roomDoc = await getRoomById(me.roomId)
  } catch (e) { /* 旧格式 roomId */ }

  if (!roomDoc) {
    const oldRoomId = me.roomId || String(Date.now()).slice(-8)
    const addRes = await db.collection('rooms').add({
      data: {
        name: '小窝' + oldRoomId.slice(-4),
        password: '',
        hostOpenid: me.host ? OPENID : '',
        createdAt: db.serverDate(),
      },
    })
    await db.collection('users').doc(me._id).update({ data: { roomId: addRes._id } })
    me = await getUserByOpenid(OPENID)
    roomDoc = await getRoomById(addRes._id)
  }

  const room = (await getRoomUsers(me.roomId)).map(publicUser)
  return { code: 0, msg: '欢迎回来', data: { me: publicUser(me), room, roomDoc: publicRoom(roomDoc) } }
}

// ============ 通过邀请链接加入房间 ============
async function joinViaInvite(event, ctx) {
  const { OPENID } = ctx
  const roomId = String(event.roomId || '').trim()
  if (!roomId) throw new Error('邀请链接无效')

  const roomDoc = await getRoomById(roomId)
  if (!roomDoc) throw new Error('房间不存在')

  let me = await getUserByOpenid(OPENID)
  if (me && me.roomId) {
    // 已绑定自己的房间：直接返回，不再搬入其他房间
    const myRoomDoc = await getRoomById(me.roomId).catch(() => null)
    const room = (await getRoomUsers(me.roomId)).map(publicUser)
    return { code: 0, msg: '你已在小窝中，直接进入', data: { me: publicUser(me), room, roomDoc: publicRoom(myRoomDoc) } }
  }

  // 检查房间人数（小窝限定两人）
  const members = await getRoomUsers(roomId)
  if (members.length >= 2) throw new Error('这间小窝已经住满啦~')

  if (me) {
    // 有档案但还没房间：搬入邀请的房间
    await db.collection('users').doc(me._id).update({ data: { roomId, host: false } })
    me = await getUserByOpenid(OPENID)
  } else {
    // 首次建档：加入邀请的房间
    const nickname = String(event.nickname || '').trim() || DEFAULT_GUEST_NICKNAME
    me = await createUserDoc(OPENID, nickname, event.avatar, roomId, false)
  }

  const room = (await getRoomUsers(roomId)).map(publicUser)
  return { code: 0, msg: `已入住「${roomDoc.name}」🎉`, data: { me: publicUser(me), room, roomDoc: publicRoom(roomDoc) } }
}

// ============ 修改资料 ============
async function updateProfile(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const data = {}
  if (event.nickname !== undefined) {
    const nick = String(event.nickname).trim()
    if (!nick) throw new Error('昵称不能为空')
    data.nickname = nick
  }
  if (event.avatar !== undefined) data.avatar = String(event.avatar)
  if (!Object.keys(data).length) throw new Error('没有需要修改的内容')

  await db.collection('users').doc(me._id).update({ data })
  const updated = await getUserByOpenid(OPENID)
  return { code: 0, msg: '已更新', data: { me: publicUser(updated) } }
}

// ============ 获取关系信息（起始日、卡片背景） ============
async function getRelationshipInfo(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me || !me.roomId) throw new Error('请先创建档案')

  const roomDoc = await getRoomById(me.roomId)
  const startDate = (roomDoc && roomDoc.startDate) || ''
  const info = {
    startDate,
    startDateLocked: Boolean(startDate),
    cardBg: (roomDoc && roomDoc.cardBg) || '',
    isHost: Boolean(me.host),
  }
  return { code: 0, msg: 'ok', data: info }
}

// ============ 设置关系信息 ============
async function setRelationshipInfo(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me || !me.roomId) throw new Error('请先创建档案')

  const roomDoc = await getRoomById(me.roomId)
  const data = {}

  if (event.startDate !== undefined) {
    // 权限校验：只有房主可以设定恋爱纪念日
    if (!me.host) {
      throw new Error('只有房主可以设定恋爱纪念日')
    }
    // 防篡改单向锁定校验：一旦设定过恋爱纪念日，后期无法修改
    if (roomDoc && roomDoc.startDate) {
      throw new Error('恋爱纪念日已锁定，无法修改')
    }

    const d = String(event.startDate).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('日期格式应为 YYYY-MM-DD')

    // 不能选未来时间
    const nowCnStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    if (d > nowCnStr) {
      throw new Error('恋爱纪念日不能是未来时间')
    }

    data.startDate = d
    data.startDateLocked = true
  }

  if (event.cardBg !== undefined) {
    data.cardBg = String(event.cardBg)
  }

  if (!Object.keys(data).length) throw new Error('没有需要修改的内容')

  await db.collection('rooms').doc(me.roomId).update({ data })
  return { code: 0, msg: '已更新', data }
}

// ============ 心跳 ============
async function heartbeat(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) return { code: 0, msg: 'ok' }

  const data = { lastActiveAt: db.serverDate() }
  if (event.networkType) {
    data.networkType = String(event.networkType).slice(0, 20)
  }

  await db.collection('users').doc(me._id).update({
    data,
  })
  return { code: 0, msg: 'ok' }
}

module.exports = { login, joinViaInvite, updateProfile, heartbeat, getRelationshipInfo, setRelationshipInfo }
