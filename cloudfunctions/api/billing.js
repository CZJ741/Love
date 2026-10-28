// 情侣记账与AA对账核心业务模块
// 支持共同钱包、个人垫付、AA均摊/请客/代付，精准计算「谁欠谁」差额并支持一键对齐结清
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')
const { checkText } = require('./secCheck')

// 获取账单列表与财务统计
async function billing_get(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')

  const roomId = me.roomId
  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  // 默认查询指定年月（格式：YYYY-MM），若未指定则使用当前年月
  let targetMonth = event.month
  if (!targetMonth) {
    const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
    targetMonth = nowCn.toISOString().slice(0, 7)
  }

  // 查询当前房间的所有历史记录以计算当前待结清差额及账单明细
  const allBillsRes = await db.collection('bills')
    .where({ roomId })
    .orderBy('billDate', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(300)
    .get()

  const allBills = allBillsRes.data || []

  // 1. 计算当前未结清「谁欠谁」净差额（站在当前用户 OPENID 视角）
  // 仅计算 settled !== true 且产生双人债务的有效消费账单
  let netDueToMeCents = 0
  let pendingCount = 0

  // 2. 统计当月指标
  let monthTotalExpenseCents = 0
  let myMonthPaidCents = 0
  let partnerMonthPaidCents = 0
  let commonMonthExpenseCents = 0

  const monthBills = []

  for (const b of allBills) {
    // 忽略历史可能存在的独立 settle 记录，只展示实际消费项目
    if (b.type === 'settle') continue

    const amount = Number(b.amountCents) || 0
    const isThisMonth = b.billDate && b.billDate.startsWith(targetMonth)

    // 当月统计
    if (isThisMonth) {
      monthBills.push(b)
      if (b.type === 'expense') {
        monthTotalExpenseCents += amount
        if (b.payerType === 'user') {
          if (b.payerOpenid === OPENID) {
            myMonthPaidCents += amount
          } else {
            partnerMonthPaidCents += amount
          }
        } else if (b.payerType === 'common') {
          commonMonthExpenseCents += amount
        }
      }
    }

    // 差额计算逻辑：只累加尚未对齐结清的项目
    if (b.type === 'expense' && b.payerType === 'user' && !b.settled) {
      const isMePaid = (b.payerOpenid === OPENID)
      if (b.splitRule === 'aa') {
        // AA平摊 50%
        const half = Math.round(amount / 2)
        if (isMePaid) {
          netDueToMeCents += half
        } else {
          netDueToMeCents -= half
        }
        pendingCount++
      } else if (b.splitRule === 'other_all') {
        // 替对方代付，对方承担 100%
        if (isMePaid) {
          netDueToMeCents += amount
        } else {
          netDueToMeCents -= amount
        }
        pendingCount++
      }
      // 若为 payer_all (请客/全包)，双方不欠钱，不属于待结清债务
    }
  }

  // 格式化账单列表用于前端展示（纯消费项目，不展示多余的结算流水行）
  const formattedBills = monthBills.map(b => {
    // 判断该账单对于当前用户的对账归属
    let settleStatus = 'none' // 'none'(不需结清,如请客/共同钱包) | 'settled'(已结清) | 'pending'(待结清)
    if (b.payerType === 'user' && (b.splitRule === 'aa' || b.splitRule === 'other_all')) {
      settleStatus = b.settled ? 'settled' : 'pending'
    }

    return {
      _id: b._id,
      type: b.type,
      category: b.category,
      amountYuan: (b.amountCents / 100).toFixed(2),
      amountCents: b.amountCents,
      payerType: b.payerType,
      payerOpenid: b.payerOpenid,
      isPayerMe: b.payerOpenid === OPENID,
      splitRule: b.splitRule,
      remark: b.remark || '',
      billDate: b.billDate,
      settled: Boolean(b.settled),
      settleStatus,
      createdAt: b.createdAt
    }
  })

  return {
    code: 0,
    data: {
      targetMonth,
      netDueToMeCents,
      pendingCount,
      netDueToMeYuan: (Math.abs(netDueToMeCents) / 100).toFixed(2),
      debtStatus: netDueToMeCents > 0 ? 'partner_owes_me' : (netDueToMeCents < 0 ? 'i_owe_partner' : 'even'),
      monthTotalExpenseYuan: (monthTotalExpenseCents / 100).toFixed(2),
      myMonthPaidYuan: (myMonthPaidCents / 100).toFixed(2),
      partnerMonthPaidYuan: (partnerMonthPaidCents / 100).toFixed(2),
      commonMonthExpenseYuan: (commonMonthExpenseCents / 100).toFixed(2),
      partnerName: partner ? (partner.name || partner.nickname || 'TA') : 'TA',
      myName: me.name || me.nickname || '我',
      bills: formattedBills
    }
  }
}

// 添加账单
async function billing_add(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')

  const { amount, category = 'dining', payerType = 'user', splitRule = 'aa', remark = '', billDate } = event
  const numAmount = parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('请输入有效金额')
  }
  if (numAmount > 100000) {
    throw new Error('单笔金额超出合理上限')
  }

  const amountCents = Math.round(numAmount * 100)

  // 内容安全审核
  const cleanRemark = (remark || '').trim().slice(0, 30)
  if (cleanRemark) {
    await checkText(cleanRemark, { openid: OPENID, scene: 2 })
  }

  // 日期处理 (默认今天)
  let validDate = billDate
  if (!validDate || !/^\d{4}-\d{2}-\d{2}$/.test(validDate)) {
    const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
    validDate = nowCn.toISOString().slice(0, 10)
  }

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID)

  // 决定支付者
  let payerOpenid = OPENID
  if (payerType === 'user') {
    if (event.whoPaid === 'partner' && partner) {
      payerOpenid = partner.openid
    } else {
      payerOpenid = OPENID
    }
  } else {
    payerOpenid = ''
  }

  const finalSplitRule = payerType === 'common' ? 'payer_all' : splitRule
  // 请客全包或共同钱包默认无需结清
  const initialSettled = (payerType === 'common' || finalSplitRule === 'payer_all')

  const billData = {
    roomId: me.roomId,
    creatorOpenid: OPENID,
    type: 'expense',
    amountCents,
    category,
    payerType,
    payerOpenid,
    splitRule: finalSplitRule,
    remark: cleanRemark,
    billDate: validDate,
    settled: initialSettled,
    createdAt: db.serverDate()
  }

  const res = await db.collection('bills').add({ data: billData })
  return { code: 0, data: { _id: res._id } }
}

// 删除账单
async function billing_delete(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')

  const { id } = event
  if (!id) throw new Error('缺少账单ID')

  const bill = await db.collection('bills').doc(id).get().then(res => res.data).catch(() => null)
  if (!bill) throw new Error('账单不存在或已删除')

  // 权限校验：必须是本房间内的成员
  if (bill.roomId !== me.roomId) {
    throw new Error('无权操作此账单')
  }

  await db.collection('bills').doc(id).remove()
  return { code: 0, msg: '删除成功' }
}

// 一键结清/对齐差额：将所有待结清的项目直接标记为已结清
async function billing_settle(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')

  const roomId = me.roomId
  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID)
  if (!partner) throw new Error('小窝还没有另一半，无需对账')

  // 查找所有尚未结清且需要结清的账单
  const unsettledRes = await db.collection('bills')
    .where({
      roomId,
      type: 'expense',
      payerType: 'user',
      settled: false
    })
    .limit(100)
    .get()

  const unsettledBills = unsettledRes.data || []

  // 筛选出确实产生债务关系的账单 (aa 或 other_all)
  const needSettleBills = unsettledBills.filter(b => b.splitRule === 'aa' || b.splitRule === 'other_all')

  if (needSettleBills.length === 0) {
    return { code: 0, msg: '当前没有待结清的账单' }
  }

  // 批量打上已结清状态标记
  const nowServerDate = db.serverDate()
  for (const b of needSettleBills) {
    await db.collection('bills').doc(b._id).update({
      data: {
        settled: true,
        settledAt: nowServerDate,
        settledBy: OPENID
      }
    })
  }

  return { code: 0, msg: '已对齐结清' }
}

module.exports = {
  billing_get,
  billing_add,
  billing_delete,
  billing_settle
}
