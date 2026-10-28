// 生理期 / 健康关怀业务模块
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')

// 计算两个日期相差的天数 (YYYY-MM-DD)
function diffDays(d1, d2) {
  const t1 = new Date(d1 + 'T00:00:00+08:00').getTime()
  const t2 = new Date(d2 + 'T00:00:00+08:00').getTime()
  return Math.round((t1 - t2) / (24 * 3600 * 1000))
}

// 给定基准日期加上天数
function addDays(d, days) {
  const t = new Date(d + 'T00:00:00+08:00').getTime() + days * 24 * 3600 * 1000
  const date = new Date(t + 8 * 3600 * 1000)
  return date.toISOString().slice(0, 10)
}

// 1. 获取生理期概览与智能预测
async function period_get(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  // 读取经期设置与记录
  let docRes = await db.collection('periods').where({ roomId }).limit(1).get()
  let periodData = docRes.data && docRes.data[0]

  if (!periodData) {
    // 默认初始化
    const initData = {
      roomId,
      femaleOpenid: '', // 未设定时由首次记录者或指定为准
      cycleDays: 28,    // 默认周期 28 天
      periodDays: 5,    // 默认经期 5 天
      records: [],      // 历史记录
      latestStartDate: '',
      lastCareAt: null,
      createdAt: db.serverDate()
    }
    const addRes = await db.collection('periods').add({ data: initData })
    periodData = { ...initData, _id: addRes._id }
  }

  // 判断当前用户是否被设定为女生/记录者（若未指定，默认女房客或可切换）
  let isFemale = false
  if (periodData.femaleOpenid) {
    isFemale = (periodData.femaleOpenid === OPENID)
  } else {
    // 若未绑定过，女生端可一键认领
    isFemale = true
  }

  const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
  const todayStr = nowCn.toISOString().slice(0, 10)

  // 算法预测
  let status = 'normal' // 'during'(经期中) | 'approaching'(快来了,前1~3天) | 'normal'(平静期)
  let dayInPeriod = 0 // 经期第几天
  let daysToNext = 0 // 离下次经期还有几天
  let nextStartDate = ''

  const latestStart = periodData.latestStartDate
  const cycleDays = periodData.cycleDays || 28
  const periodDays = periodData.periodDays || 5

  if (latestStart) {
    const elapsed = diffDays(todayStr, latestStart)

    if (elapsed >= 0 && elapsed < periodDays) {
      // 正在经期中
      status = 'during'
      dayInPeriod = elapsed + 1
      nextStartDate = addDays(latestStart, cycleDays)
      daysToNext = diffDays(nextStartDate, todayStr)
    } else if (elapsed >= periodDays) {
      // 已过上次经期，推算下一次
      nextStartDate = addDays(latestStart, cycleDays)
      daysToNext = diffDays(nextStartDate, todayStr)

      if (daysToNext <= 3 && daysToNext >= 0) {
        status = 'approaching'
      } else if (daysToNext < 0) {
        // 延期了
        status = 'delayed'
      } else {
        status = 'normal'
      }
    } else {
      // 未来记录
      status = 'normal'
      daysToNext = Math.abs(elapsed)
    }
  }

  return {
    code: 0,
    data: {
      isFemale,
      femaleOpenid: periodData.femaleOpenid,
      cycleDays,
      periodDays,
      latestStartDate: periodData.latestStartDate,
      nextStartDate,
      status,
      dayInPeriod,
      daysToNext,
      records: (periodData.records || []).slice(0, 12),
      partnerName: partner ? (partner.name || partner.nickname || 'TA') : 'TA',
      myName: me.name || me.nickname || '我',
      lastCareAt: periodData.lastCareAt
    }
  }
}

// 2. 记录/更新经期打卡 (女生操作)
async function period_record(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const { startDate, actionType = 'start', painLevel = 1, mood = 'normal', cycleDays, periodDays } = event

  let docRes = await db.collection('periods').where({ roomId }).limit(1).get()
  let periodData = docRes.data && docRes.data[0]

  const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
  const todayStr = nowCn.toISOString().slice(0, 10)
  const targetDate = startDate || todayStr

  const updateFields = {
    updatedAt: db.serverDate()
  }

  // 绑定 femaleOpenid
  if (!periodData || !periodData.femaleOpenid) {
    updateFields.femaleOpenid = OPENID
  }

  if (cycleDays) updateFields.cycleDays = parseInt(cycleDays) || 28
  if (periodDays) updateFields.periodDays = parseInt(periodDays) || 5

  if (actionType === 'start') {
    updateFields.latestStartDate = targetDate
    // 记入历史流水
    const newRecord = {
      startDate: targetDate,
      painLevel,
      mood,
      recordedAt: targetDate
    }
    updateFields.records = _.unshift([newRecord])
  }

  if (!periodData) {
    await db.collection('periods').add({
      data: {
        roomId,
        femaleOpenid: OPENID,
        cycleDays: parseInt(cycleDays) || 28,
        periodDays: parseInt(periodDays) || 5,
        latestStartDate: targetDate,
        records: [{ startDate: targetDate, painLevel, mood, recordedAt: targetDate }],
        createdAt: db.serverDate()
      }
    })
  } else {
    await db.collection('periods').doc(periodData._id).update({
      data: updateFields
    })
  }

  return { code: 0, msg: '记录成功 💕' }
}

// 3. 男生一键送出暖心关怀 (如红糖水/揉肚子抱抱)
async function period_remind(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const { careType = 'tea', message = '热乎乎的红糖水送到啦，要乖乖休息哦~' } = event

  let docRes = await db.collection('periods').where({ roomId }).limit(1).get()
  if (docRes.data && docRes.data[0]) {
    await db.collection('periods').doc(docRes.data[0]._id).update({
      data: {
        lastCareAt: db.serverDate(),
        lastCareType: careType,
        lastCareFrom: OPENID
      }
    })
  }

  return { code: 0, msg: '暖心关怀已送达伴侣 💕' }
}

// 4. 设置绑定角色（指定谁是关怀的女生）
async function period_set_female(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const { targetOpenid } = event
  const openidToSet = targetOpenid || OPENID

  let docRes = await db.collection('periods').where({ roomId }).limit(1).get()
  if (docRes.data && docRes.data[0]) {
    await db.collection('periods').doc(docRes.data[0]._id).update({
      data: { femaleOpenid: openidToSet }
    })
  } else {
    await db.collection('periods').add({
      data: {
        roomId,
        femaleOpenid: openidToSet,
        cycleDays: 28,
        periodDays: 5,
        records: [],
        createdAt: db.serverDate()
      }
    })
  }

  return { code: 0, msg: '身份设置成功' }
}

module.exports = {
  period_get,
  period_record,
  period_remind,
  period_set_female
}
