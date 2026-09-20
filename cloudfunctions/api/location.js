// 双人情侣定位与朝向共享模块
// 只有在双方均授权同意后，才共享位置与朝向信息（保护情侣隐私安全）
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')

// 获取或初始化定位配置及双方数据
async function locationGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  const res = await db.collection('locations').where({ roomId }).limit(1).get()
  let locDoc = res.data[0]

  if (!locDoc) {
    const initData = {
      roomId,
      sharedUsers: {}, // { [openid]: boolean } 记录各自是否同意开启共享
      positions: {}, // { [openid]: { latitude, longitude, direction, address, updatedAt } }
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    const addRes = await db.collection('locations').add({ data: initData })
    locDoc = { ...initData, _id: addRes._id }
  }

  const sharedUsers = locDoc.sharedUsers || {}
  const positions = locDoc.positions || {}

  const myAgreed = Boolean(sharedUsers[OPENID])
  const partnerAgreed = partner ? Boolean(sharedUsers[partner.openid]) : false
  const bothAgreed = myAgreed && partnerAgreed

  return {
    code: 0,
    data: {
      myAgreed,
      partnerAgreed,
      bothAgreed,
      myPos: positions[OPENID] || null,
      // 只有在双方都同意后，才下发对方的位置信息，严格保护隐私
      partnerPos: bothAgreed && partner ? (positions[partner.openid] || null) : null,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar } : null
    }
  }
}

// 设置/切换我的共享意愿（开启或关闭）
async function locationToggleShare(event, ctx) {
  const { OPENID } = ctx
  const { agreed } = event
  const isAgreed = Boolean(agreed)

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const res = await db.collection('locations').where({ roomId }).limit(1).get()
  let locDoc = res.data[0]
  if (!locDoc) {
    await locationGet(event, ctx)
    const fresh = await db.collection('locations').where({ roomId }).limit(1).get()
    locDoc = fresh.data[0]
  }

  const updateData = {
    [`sharedUsers.${OPENID}`]: isAgreed,
    updatedAt: db.serverDate()
  }

  // 若关闭共享，同时清除我的位置记录
  if (!isAgreed) {
    updateData[`positions.${OPENID}`] = _.set(null)
  }

  await db.collection('locations').doc(locDoc._id).update({
    data: updateData
  })

  return { code: 0, data: { agreed: isAgreed } }
}

// 上报我的当前经纬度与朝向角度
async function locationUpdate(event, ctx) {
  const { OPENID } = ctx
  const { latitude, longitude, direction, address = '' } = event

  if (latitude === undefined || longitude === undefined) {
    throw new Error('经纬度参数不完整')
  }

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const res = await db.collection('locations').where({ roomId }).limit(1).get()
  let locDoc = res.data[0]
  if (!locDoc) {
    await locationGet(event, ctx)
    const fresh = await db.collection('locations').where({ roomId }).limit(1).get()
    locDoc = fresh.data[0]
  }

  const sharedUsers = locDoc.sharedUsers || {}
  if (!sharedUsers[OPENID]) {
    throw new Error('您尚未同意开启共享位置')
  }

  const posData = {
    latitude: Number(latitude),
    longitude: Number(longitude),
    direction: direction !== undefined ? Number(direction) : 0, // 朝向角度（0~360度）
    address: String(address || '').slice(0, 100),
    updatedAt: Date.now()
  }

  await db.collection('locations').doc(locDoc._id).update({
    data: {
      [`positions.${OPENID}`]: _.set(posData),
      updatedAt: db.serverDate()
    }
  })

  return { code: 0, data: posData }
}

module.exports = {
  locationGet,
  locationToggleShare,
  locationUpdate
}
