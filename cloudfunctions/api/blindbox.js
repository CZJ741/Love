// 碎片盲盒：每天随机一个互动小任务，双方都完成打卡后各得积分
const { db, _, getUserByOpenid, getRoomUsers, cnDateStr, round } = require('./helpers')
const { earn } = require('./economy')

const TASKS = [
  '亲一下', '倒杯水', '夸我一句', '捶捶背', '抱抱30秒', '讲个笑话',
  '喂我一口好吃的', '帮我揉揉肩', '叫我起床', '唱首歌给我听', '跳支舞', '拍一张合照',
]
const REWARD = 20 // 双方都完成后各得的积分

// 获取今日任务（没有则随机生成并落库，保证两人看到同一个任务）
async function blindBoxGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const date = cnDateStr()
  let daily = await db.collection('dailies').where({ roomId: me.roomId, date }).limit(1).get()
  if (!daily.data.length) {
    const task = TASKS[Math.floor(Math.random() * TASKS.length)]
    const addRes = await db.collection('dailies').add({
      data: { roomId: me.roomId, date, task, completers: [], createdAt: db.serverDate() },
    })
    daily = { data: [{ _id: addRes._id, roomId: me.roomId, date, task, completers: [] }] }
  }
  const d = daily.data[0]
  return { code: 0, data: { daily: d, myDone: (d.completers || []).includes(OPENID), reward: REWARD } }
}

// 完成任务并上传照片打卡（照片先由前端上传云存储，这里记录 fileID）
async function blindBoxUpload(event, ctx) {
  const { OPENID } = ctx
  const { fileId } = event
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const date = cnDateStr()
  const dailyRes = await db.collection('dailies').where({ roomId: me.roomId, date }).limit(1).get()
  if (!dailyRes.data.length) throw new Error('今天还没有惊喜任务')
  const daily = dailyRes.data[0]
  const completers = daily.completers || []
  if (completers.includes(OPENID)) throw new Error('今天已经完成任务啦~')

  // 直接写完整的数组与 proof（不依赖 addToSet/set 指令，保证各版本 SDK 行为一致）
  const newCompleters = completers.slice()
  newCompleters.push(OPENID)
  await db.collection('dailies').doc(daily._id).update({
    data: {
      completers: newCompleters,
      // proof 字段可能不存在或为空，用 _.set 整体替换，避免嵌套更新失败
      proof: _.set({ ...(daily.proof || {}), [OPENID]: fileId }),
    },
  })

  const roomUsers = await getRoomUsers(me.roomId)
  const allDone = roomUsers.length === 2 && completers.length + 1 === 2
  if (!allDone) {
    return { code: 0, msg: '打卡成功，等TA也完成任务，一起领积分~', data: { allDone: false } }
  }

  const earned = REWARD
  for (const u of roomUsers) {
    await earn({
      userDoc: u, earned, type: 'surprise', reason: '今日惊喜任务完成',
      fromUser: '🎁 惊喜', fromOpenid: 'system',
    })
  }
  return { code: 0, msg: `双方任务完成，各 +${earned} 分`, data: { allDone: true, earned } }
}

module.exports = { blindBoxGet, blindBoxUpload }
