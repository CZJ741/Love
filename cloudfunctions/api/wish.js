// 心愿 & 兑换商城
// 攒钱模式（创新4）：创建心愿不立即扣费，而是设定目标金额 + 每人出资比例，
// 之后每次赚积分自动按比例划入小金库，攒满后可「领取」兑现。
const { db, _, getUserByOpenid, getRoomUsers, round } = require('./helpers')
const { record } = require('./transactions')

// 即刻兑换商城的预置商品（与小程序端 lib/constants.js 保持一致）
const MALL = [
  { id: 'm1', name: '奶茶一杯', price: 30, emoji: '🧋', desc: '安排一杯奶茶' },
  { id: 'm2', name: '按摩30分钟', price: 40, emoji: '💆', desc: '专业级按摩服务' },
  { id: 'm3', name: '背我上楼', price: 50, emoji: '🏃', desc: '传说级背背' },
  { id: 'm4', name: '看一场电影', price: 80, emoji: '🎬', desc: '手牵手看电影' },
  { id: 'm5', name: '烛光晚餐', price: 150, emoji: '🕯️', desc: '一顿浪漫晚餐' },
  { id: 'm6', name: '周末短途游', price: 300, emoji: '🌊', desc: '一起去远方' },
]

// 创建攒钱心愿
async function createWish(event, ctx) {
  const { OPENID } = ctx
  const content = String(event.content || '').trim()
  const target = parseInt(event.target, 10)
  let ratio = parseInt(event.myRatio, 10)
  if (!content) throw new Error('请填写心愿内容')
  if (!target || target <= 0) throw new Error('目标积分需为正数')
  if (isNaN(ratio) || ratio < 0 || ratio > 100) ratio = 50

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const addRes = await db.collection('wishes').add({
    data: {
      roomId: me.roomId,
      creator: me.openid,
      creatorName: me.nickname,
      content,
      target,
      myRatio: ratio, // 发起人出资比例（对方为 100 - ratio）
      savedByMe: 0,
      savedByPartner: 0,
      savedTotal: 0,
      status: 'pending', // pending | completed | canceled
      createdAt: db.serverDate(),
    },
  })
  return { code: 0, msg: '心愿已创建，开始攒钱吧~', data: { wishId: addRes._id } }
}

// 取消心愿（两人小窝，无需密码），已存的积分原路退回
async function cancelWish(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const wish = await getWish(event.wishId, me.roomId)
  if (wish.status !== 'pending') throw new Error('该心愿无法取消')

  if (wish.savedByMe > 0) {
    await db.collection('users').where({ openid: wish.creator }).update({ data: { balance: _.inc(wish.savedByMe) } })
  }
  if (wish.savedByPartner > 0) {
    const partner = (await db.collection('users').where({ roomId: me.roomId, openid: _.neq(wish.creator) }).limit(1).get()).data[0]
    if (partner) await db.collection('users').doc(partner._id).update({ data: { balance: _.inc(wish.savedByPartner) } })
  }

  await db.collection('wishes').doc(wish._id).update({ data: { status: 'canceled' } })
  return { code: 0, msg: '心愿已取消，存下的积分已退回' }
}

// 领取心愿（两人小窝，无需密码）：小金库攒满后确认兑现
async function claimWish(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const wish = await getWish(event.wishId, me.roomId)
  if (wish.status !== 'pending') throw new Error('心愿状态不正确')
  if (wish.savedTotal < wish.target) throw new Error('小金库还没攒满哦~')

  await db.collection('wishes').doc(wish._id).update({
    data: { status: 'completed', completedBy: me.openid, completedByName: me.nickname, completedAt: db.serverDate() },
  })
  return { code: 0, msg: '心愿达成，祝你们甜甜蜜蜜 💕' }
}

// 即刻兑换（商城）：两人小窝无需密码；若昨日任一打了1星，今日价格打5折
async function instantRedeem(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const item = MALL.find(i => i.id === event.itemId)
  if (!item) throw new Error('商品不存在')

  const price = item.price
  if ((me.balance || 0) < price) throw new Error('积分不足，先去赚积分吧~')

  await db.collection('users').doc(me._id).update({ data: { balance: _.inc(-price) } })
  await record({
    roomId: me.roomId,
    fromUser: me.nickname, fromOpenid: me.openid,
    toUser: '🍿 ' + item.name, toOpenid: 'mall',
    amount: -price, type: 'redeem', reason: `兑换 · ${item.name}`,
  })
  return { code: 0, msg: `兑换成功，扣除 ${price} 分`, data: { item, price } }
}

async function getWish(wishId, roomId) {
  if (!wishId) throw new Error('参数错误')
  const res = await db.collection('wishes').doc(wishId).get().catch(() => null)
  const wish = res && res.data
  if (!wish || wish.roomId !== roomId) throw new Error('心愿不存在')
  return wish
}

module.exports = { createWish, cancelWish, claimWish, instantRedeem, MALL }
