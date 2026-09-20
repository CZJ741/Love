// 积分削减机制：当双方超过 3 天未互动时，每天自动削减双方积分各 5 分（最低扣至 0 分止）
const { db, _, getUserByOpenid, getRoomUsers, getRoomById, cnDateStr } = require('./helpers')
const { record } = require('./transactions')

const THREE_DAYS_MS = 3 * 24 * 3600 * 1000 // 3天（72小时）
const DECAY_DAILY_POINTS = 5 // 每天削减5分

/**
 * 检查并执行积分削减
 */
async function checkDecay(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me || !me.roomId) {
    return { code: 0, data: { decayed: false } }
  }

  const roomId = me.roomId
  const todayStr = cnDateStr()

  // 1. 获取房间信息与房间成员
  const roomDoc = await getRoomById(roomId)
  if (!roomDoc) {
    return { code: 0, data: { decayed: false } }
  }

  const roomUsers = await getRoomUsers(roomId)
  // 如果另一半尚未入住，暂不开启削减惩罚
  if (roomUsers.length < 2) {
    return { code: 0, data: { decayed: false } }
  }

  // 如果今天已经扣过，直接跳过，防止重复扣除
  if (roomDoc.lastDecayDate === todayStr) {
    return { code: 0, data: { decayed: false } }
  }

  // 2. 查找最近一笔「非 decay」的有效互动流水
  const txRes = await db.collection('transactions')
    .where({ roomId, type: _.neq('decay') })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()

  let lastActiveTs = 0
  if (txRes.data && txRes.data.length > 0) {
    const tx = txRes.data[0]
    lastActiveTs = tx.createdAt ? new Date(tx.createdAt).getTime() : 0
  }

  // 若无任何流水记录，则以房间创建时间或用户创建时间为基准
  if (!lastActiveTs) {
    if (roomDoc.createdAt) {
      lastActiveTs = new Date(roomDoc.createdAt).getTime()
    } else if (me.createdAt) {
      lastActiveTs = new Date(me.createdAt).getTime()
    } else {
      lastActiveTs = Date.now()
    }
  }

  const now = Date.now()
  const diffMs = now - lastActiveTs

  // 未满 3 天，不触发削减
  if (diffMs < THREE_DAYS_MS) {
    return { code: 0, data: { decayed: false } }
  }

  // 3. 计算超期天数
  const decayStartTs = lastActiveTs + THREE_DAYS_MS
  const startDateStr = new Date(decayStartTs + 8 * 3600 * 1000).toISOString().slice(0, 10)

  let baseDateStr = roomDoc.lastDecayDate || ''
  if (!baseDateStr || baseDateStr < startDateStr) {
    baseDateStr = startDateStr
  }

  const dBase = new Date(baseDateStr + 'T00:00:00+08:00')
  const dToday = new Date(todayStr + 'T00:00:00+08:00')
  const diffDays = Math.round((dToday - dBase) / (24 * 3600 * 1000))

  let pendingDays = roomDoc.lastDecayDate ? diffDays : (diffDays + 1)
  if (pendingDays <= 0) {
    pendingDays = 1
  }

  // 单次结算最多累计 7 天（35分），避免长期未上线一次性扣分过多带来挫败感
  pendingDays = Math.min(pendingDays, 7)
  const pointsToDeduct = pendingDays * DECAY_DAILY_POINTS

  // 4. 原子锁定：更新房间 lastDecayDate，防止并发重复扣分
  const lockRes = await db.collection('rooms').where({
    _id: roomId,
    lastDecayDate: _.or([_.neq(todayStr), _.exists(false)]),
  }).update({
    data: {
      lastDecayDate: todayStr,
    },
  })

  // 更新条数为 0 说明已被另一个并发请求处理过
  if (!lockRes.stats || lockRes.stats.updated === 0) {
    return { code: 0, data: { decayed: false } }
  }

  // 5. 对房间内双方执行扣分（扣至 0 为止）并写入流水
  let myDeducted = 0
  let partnerDeducted = 0

  for (const u of roomUsers) {
    const currentBal = u.balance || 0
    const actual = Math.min(pointsToDeduct, currentBal)

    if (actual > 0) {
      await record({
        roomId,
        fromUser: '❄️ 降温惩罚',
        fromOpenid: 'system',
        toUser: u.nickname,
        toOpenid: u.openid,
        amount: -actual,
        type: 'decay',
        reason: '超过3天未互动 · 积分削减',
      })

      await db.collection('users').doc(u._id).update({
        data: {
          balance: _.inc(-actual),
        },
      })
    }

    if (u.openid === OPENID) {
      myDeducted = actual
    } else {
      partnerDeducted = actual
    }
  }

  // 重新获取最新余额
  const freshUsers = await getRoomUsers(roomId)
  const meFresh = freshUsers.find(u => u.openid === OPENID)
  const partnerFresh = freshUsers.find(u => u.openid !== OPENID)

  return {
    code: 0,
    msg: '已结算未互动积分削减',
    data: {
      decayed: true,
      pendingDays,
      pointsToDeduct,
      myDeducted,
      partnerDeducted,
      myBalance: meFresh ? (meFresh.balance || 0) : 0,
      partnerBalance: partnerFresh ? (partnerFresh.balance || 0) : 0,
    },
  }
}

module.exports = { checkDecay }
