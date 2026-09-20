// 积分流水统一模块
// 所有积分变动都必须通过 record() 写入流水，保证：
//   1. 先写流水，再改余额 —— 流水写入失败则余额不变
//   2. 流水文档结构统一
//   3. 房间内双人共享全部流水记录
const { db, _, getUserByOpenid } = require('./helpers')

/**
 * 记录一笔积分变动流水（仅写流水，不涉及余额变更）
 *
 * 文档结构：
 *   roomId     - 房间ID，用于双人共享查询
 *   fromUser   - 操作人昵称
 *   fromOpenid - 操作人 openid
 *   toUser     - 目标用户昵称
 *   toOpenid   - 目标用户 openid
 *   amount     - 变动金额（正数=收入，负数=支出）
 *   type       - 变动类型：reward / punish / sign / redeem / surprise
 *   reason     - 变动原因
 *   createdAt  - 服务端时间戳
 */
async function record(params) {
  const {
    roomId, fromUser, fromOpenid,
    toUser, toOpenid,
    amount, type, reason,
  } = params

  await db.collection('transactions').add({
    data: {
      roomId,
      fromUser: String(fromUser || '❤️ 爱神'),
      fromOpenid: String(fromOpenid || 'system'),
      toUser: String(toUser || ''),
      toOpenid: String(toOpenid || ''),
      amount: Number(amount),
      type: String(type || 'reward'),
      reason: String(reason || '').slice(0, 30),
      createdAt: db.serverDate(),
    },
  })
}

/**
 * 给用户加积分（写流水 + 改余额，保证数据一致性）
 *
 * 调用方需自行处理心愿划拨逻辑；
 * 本函数仅负责：写流水 → 更新余额
 */
async function creditUser(userDoc, amount, type, reason, fromUser, fromOpenid) {
  if (!userDoc || !userDoc._id) throw new Error('用户档案不存在')
  if (!amount || amount <= 0) throw new Error('金额必须大于0')

  // 1. 先写流水
  await record({
    roomId: userDoc.roomId,
    fromUser, fromOpenid,
    toUser: userDoc.nickname, toOpenid: userDoc.openid,
    amount, type, reason,
  })

  // 2. 再改余额
  const updateData = { totalEarned: _.inc(amount) }
  updateData.balance = _.inc(amount)
  await db.collection('users').doc(userDoc._id).update({ data: updateData })
}

/**
 * 扣用户积分（写流水 + 改余额，保证数据一致性）
 */
async function deductUser(userDoc, amount, type, reason, fromUser, fromOpenid) {
  if (!userDoc || !userDoc._id) throw new Error('用户档案不存在')
  if (!amount || amount <= 0) throw new Error('金额必须大于0')

  const actual = Math.min(amount, userDoc.balance || 0)
  if (actual <= 0) throw new Error('积分已经见底啦~')

  // 1. 先写流水
  await record({
    roomId: userDoc.roomId,
    fromUser, fromOpenid,
    toUser: userDoc.nickname, toOpenid: userDoc.openid,
    amount: -actual, type, reason,
  })

  // 2. 再改余额
  await db.collection('users').doc(userDoc._id).update({ data: { balance: _.inc(-actual) } })

  return actual
}

/**
 * 云函数端点：查询房间内全部流水（双方共享，绕过前端读权限）
 */
async function listTransactions(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const res = await db.collection('transactions')
    .where({ roomId: me.roomId })
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()
  return { code: 0, data: res.data }
}

module.exports = { record, creditUser, deductUser, listTransactions }