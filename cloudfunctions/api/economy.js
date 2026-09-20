// 经济系统：心愿小金库划拨、积分入账
//
// 说明：每次「赚取」的积分，会先按心愿的出资比例自动划入正在攒钱的心愿；
// 划拨后剩余部分才进入余额。心愿攒满后不再占用新收入。
// 流水记录全额 earned，方便双人查看完整的积分变动。

const { db, _ } = require('./helpers')
const { record } = require('./transactions')

// 把一笔收入按比例划入心愿小金库
//  - 心愿按创建时间先后依次填满，填满后自动轮到下一个
//  - 出资比例：心愿发起人按 myRatio%，另一位按 (100 - myRatio)%
// 返回 { allocated, remaining } —— allocated 为划入心愿的金额，remaining 为进入余额的金额
async function allocateEarnings({ roomId, earnerOpenid, amount }) {
  const res = await db.collection('wishes')
    .where({ roomId, status: 'pending' })
    .orderBy('createdAt', 'asc')
    .limit(10)
    .get()

  let remaining = amount
  let totalAllocated = 0
  for (const w of res.data) {
    if (remaining <= 0) break

    const need = w.target - w.savedTotal
    if (need <= 0) continue

    const myRatio = w.creator === earnerOpenid ? w.myRatio : (100 - w.myRatio)
    let alloc = Math.round(amount * myRatio / 100)
    if (alloc > need) alloc = need
    if (alloc <= 0) continue

    const isMe = w.creator === earnerOpenid
    await db.collection('wishes').doc(w._id).update({
      data: {
        savedTotal: _.inc(alloc),
        [isMe ? 'savedByMe' : 'savedByPartner']: _.inc(alloc),
      },
    })
    totalAllocated += alloc
    remaining -= alloc
  }
  return { allocated: totalAllocated, remaining }
}

// 给某用户记一笔「赚取的积分」：
//   1) 自动划拨到心愿小金库
//   2) 写流水（记录全额 earned，skipRecord=true 时跳过）
//   3) 剩余部分进入余额
// bonusNote 用于在流水原因后追加好人卡奖励说明
async function earn({ userDoc, earned, type, reason, fromUser, fromOpenid, skipRecord, bonusNote }) {
  const { allocated } = await allocateEarnings({
    roomId: userDoc.roomId,
    earnerOpenid: userDoc.openid,
    amount: earned,
  })
  const toBalance = earned - allocated

  // 1. 写流水（记录全额，方便双方看到完整积分变动）
  if (!skipRecord) {
    let finalReason = String(reason || '').slice(0, 100)
    if (bonusNote) finalReason = (finalReason + '（' + bonusNote + '）').slice(0, 50)
    await record({
      roomId: userDoc.roomId,
      fromUser, fromOpenid,
      toUser: userDoc.nickname, toOpenid: userDoc.openid,
      amount: earned, type, reason: finalReason,
    })
  }

  // 2. 更新余额
  const data = { totalEarned: _.inc(earned) }
  if (toBalance > 0) data.balance = _.inc(toBalance)
  await db.collection('users').doc(userDoc._id).update({ data })

  return allocated
}

module.exports = { allocateEarnings, earn }