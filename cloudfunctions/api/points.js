// 积分核心：加分、扣分（惩罚）、签到、快捷赞美
const { db, _, getUserByOpenid, getRoomUsers, todayStartServerDate, cnDateStr } = require('./helpers')
const { earn } = require('./economy')
const { record, deductUser } = require('./transactions')

const SIGN_BASE = 10 // 每日签到基础分

// 快捷赞美预设理由
const PRAISE_REASONS = [
  '今天特别贴心', '好温柔呀', '真可爱', '辛苦了', '笑起来真好看',
  '有你真好', '最爱你了', '今天很帅', '超棒的', '抱抱',
]

// 从 roomUsers 中提取我/对方的余额（服务端读取，无视前端权限）
function extractBalances(roomUsers, myOpenid) {
  const me = roomUsers.find(u => u.openid === myOpenid)
  const partner = roomUsers.find(u => u.openid !== myOpenid)
  return {
    myBalance: me ? (me.balance || 0) : 0,
    partnerBalance: partner ? (partner.balance || 0) : 0,
  }
}

// 给「对方」加分
async function addPoints(event, ctx) {
  const { OPENID } = ctx
  const { toOpenid, amount, reason } = event
  const amountInt = parseInt(amount, 10)
  if (!toOpenid || !amountInt || amountInt <= 0) throw new Error('加分必须大于0')
  const reasonStr = String(reason || '无理由').slice(0, 100)

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  const target = await getUserByOpenid(toOpenid)
  if (!target || target.roomId !== me.roomId) throw new Error('TA不在小窝中')
  if (target.openid === me.openid) throw new Error('不能给自己加分哦~')

  const receiverGets = amountInt

  await earn({
    userDoc: target, earned: receiverGets, type: 'reward', reason: reasonStr,
    fromUser: me.nickname, fromOpenid: me.openid,
  })

  const freshUsers = await getRoomUsers(me.roomId)
  const balances = extractBalances(freshUsers, OPENID)

  return {
    code: 0,
    msg: `${target.nickname} +${receiverGets} 分`,
    data: { receiverGets, ...balances },
  }
}

// 快捷赞美：长按对方头像弹出，小分值 1-5，无好人卡
async function quickPraise(event, ctx) {
  const { OPENID } = ctx
  const { toOpenid, amount, reason } = event
  const amountInt = parseInt(amount, 10)
  if (!toOpenid || !amountInt || amountInt < 1 || amountInt > 5) throw new Error('赞美分值需为1-5')
  const reasonStr = String(reason || '赞美').slice(0, 30)

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  const target = await getUserByOpenid(toOpenid)
  if (!target || target.roomId !== me.roomId) throw new Error('TA不在小窝中')
  if (target.openid === me.openid) throw new Error('不能赞美自己哦~')

  // 1. 写流水
  await record({
    roomId: me.roomId,
    fromUser: me.nickname, fromOpenid: me.openid,
    toUser: target.nickname, toOpenid: target.openid,
    amount: amountInt, type: 'praise', reason: '💬 ' + reasonStr,
  })

  // 2. 更新对方余额
  await db.collection('users').doc(target._id).update({
    data: { balance: _.inc(amountInt), totalEarned: _.inc(amountInt) },
  })

  // 重新读取双方余额
  const freshUsers = await getRoomUsers(me.roomId)
  const balances = extractBalances(freshUsers, OPENID)

  return { code: 0, msg: '赞美已送达 💕', data: { amount: amountInt, reason: reasonStr, ...balances } }
}

// 扣分（惩罚）—— 对方积分不足则最多扣到 0
async function punish(event, ctx) {
  const { OPENID } = ctx
  const { toOpenid, amount, reason } = event
  const amountInt = parseInt(amount, 10)
  if (!toOpenid || !amountInt || amountInt <= 0) throw new Error('扣分必须大于0')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  const target = await getUserByOpenid(toOpenid)
  if (!target || target.roomId !== me.roomId) throw new Error('TA不在小窝中')
  if (target.openid === me.openid) throw new Error('不能惩罚自己哦~')

  const actual = await deductUser(
    target, amountInt, 'punish',
    String(reason || '惩罚').slice(0, 30),
    me.nickname, me.openid,
  )

  // 重新读取双方余额
  const freshUsers = await getRoomUsers(me.roomId)
  const balances = extractBalances(freshUsers, OPENID)

  return { code: 0, msg: `已扣除 ${target.nickname} ${actual} 分`, data: { actual, ...balances } }
}

// 每日签到
async function signIn(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const today = todayStartServerDate()
  const dup = await db.collection('transactions')
    .where({ roomId: me.roomId, fromOpenid: OPENID, type: 'sign', createdAt: _.gte(today) })
    .limit(1).get()
  if (dup.data.length) throw new Error('今天已经签到过啦~')

  const earnedAmount = SIGN_BASE

  await earn({
    userDoc: me, earned: earnedAmount, type: 'sign', reason: '每日签到',
    fromUser: me.nickname, fromOpenid: OPENID,
  })

  // 重新读取双方余额
  const freshUsers = await getRoomUsers(me.roomId)
  const balances = extractBalances(freshUsers, OPENID)

  return { code: 0, msg: `签到成功 +${earnedAmount} 分`, data: { earned: earnedAmount, ...balances } }
}

module.exports = { addPoints, quickPraise, punish, signIn }