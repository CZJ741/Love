// 双人虚拟桌宠模块（QQ宠物式养成体验）
// 两人共养同一只宠物，状态数值包含：饱食度 (hunger)、心情 (mood)、体力 (energy)
// 对双方的操作（投喂、爱抚、玩耍、赠礼、洗澡、休息）即时产生情绪反应，并记录互动足迹

const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')

// 宠物默认配置
const MAX_STAT = 100
const DEFAULT_PET = {
  name: '小糯米',
  type: 'dog', // 轮廓清晰治愈可爱小狗
  hunger: 80,  // 饱食度 0~100
  mood: 85,    // 心情 0~100
  energy: 90,  // 体力 0~100
  level: 1,    // 成长等级
  exp: 0,      // 成长经验
  actionState: 'idle_happy', // 当前动作/表情状态
  lastInteractedAt: Date.now(),
  lastActionUser: '',
  lastActionText: '小狗正在安睡待机中...',
}

// 情绪与表情状态枚举（至少 6~8 种表情状态）
// 1. happy（开心满足 - 被喂食、赞扬）
// 2. sad（委屈难过 - 饥饿或长时间被冷落）
// 3. surprise（惊喜兴奋 - 收到惊喜礼物、暴击互动）
// 4. normal（平静待机 - 日常无操作）
// 5. expectant（撒娇期待 - 等待摸摸、讨食）
// 6. sleepy（困倦疲惫 - 深夜或体力低）
// 7. play（欢快玩耍）
// 8. clean（沐浴清洁）

// 计算时间流逝带来的属性自然衰减（每小时微量衰减）
function calcDecayedStats(pet) {
  const now = Date.now()
  const lastTime = pet.lastInteractedAt || now
  const elapsedHours = Math.max(0, (now - lastTime) / (3600 * 1000))

  // 每小时自然消耗：饥饿 -3，心情 -2，体力根据时间（深夜消耗少，白天多）
  const hungerDecay = Math.floor(elapsedHours * 3)
  const moodDecay = Math.floor(elapsedHours * 2)

  let hunger = Math.max(0, Math.min(MAX_STAT, (pet.hunger !== undefined ? pet.hunger : 80) - hungerDecay))
  let mood = Math.max(0, Math.min(MAX_STAT, (pet.mood !== undefined ? pet.mood : 85) - moodDecay))
  let energy = Math.max(0, Math.min(MAX_STAT, pet.energy !== undefined ? pet.energy : 90))

  // 判断是否处于深夜（23:00 ~ 07:00）
  const hour = new Date(now + 8 * 3600 * 1000).getUTCHours()
  const isNight = hour >= 23 || hour < 7

  let actionState = pet.actionState || 'normal'
  // 若状态过低自动触发对应情绪
  if (isNight || energy < 20) {
    actionState = 'sleepy'
  } else if (hunger < 30 || mood < 30) {
    actionState = 'sad'
  } else if (hunger > 70 && mood > 70) {
    actionState = 'happy'
  }

  return {
    ...pet,
    hunger,
    mood,
    energy,
    actionState
  }
}

// 1. 获取宠物状态（自动建宠与自然衰减）
async function petGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const roomUsers = await getRoomUsers(roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  let petDoc = res.data[0]

  if (!petDoc) {
    const initPet = {
      roomId,
      ...DEFAULT_PET,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    const addRes = await db.collection('pets').add({ data: initPet })
    petDoc = { ...initPet, _id: addRes._id }
  }

  // 应用时间衰减
  const updatedPet = calcDecayedStats(petDoc)

  return {
    code: 0,
    data: {
      pet: updatedPet,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar } : null
    }
  }
}

// 2. 与宠物互动动作：feed(喂食) | pet(抚摸) | play(玩耍) | gift(送礼) | sleep(休息) | poke(轻戳桌面)
async function petInteract(event, ctx) {
  const { OPENID } = ctx
  const { action = 'pet' } = event // 'feed' | 'pet' | 'play' | 'gift' | 'sleep' | 'poke'

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  let petDoc = res.data[0]
  if (!petDoc) {
    await petGet(event, ctx)
    const fresh = await db.collection('pets').where({ roomId }).limit(1).get()
    petDoc = fresh.data[0]
  }

  const current = calcDecayedStats(petDoc)
  let { hunger, mood, energy, level = 1, exp = 0 } = current
  let actionState = 'happy'
  let logText = ''
  let replyText = ''
  const myName = me.nickname || '宝宝'

  switch (action) {
    case 'feed': // 投喂
      if (hunger >= MAX_STAT) {
        actionState = 'happy'
        replyText = '小狗肚子圆滚滚的，吃饱饱啦！'
        logText = `${myName} 投喂了肉干，小狗饱饱地舔了舔嘴巴`
      } else {
        hunger = Math.min(MAX_STAT, hunger + 25)
        mood = Math.min(MAX_STAT, mood + 10)
        exp += 15
        actionState = 'happy'
        replyText = '大口嚼肉干！饱食度+25，超开心~'
        logText = `${myName} 投喂了香喷喷的肉干，饱食度暴涨！`
      }
      break

    case 'pet': // 抚摸/爱抚
      mood = Math.min(MAX_STAT, mood + 18)
      exp += 10
      actionState = 'expectant'
      replyText = '呼噜呼噜~ 小狗舒服地眯起眼睛摇尾巴！'
      logText = `${myName} 温柔摸了摸小狗的下巴，心情大好！`
      break

    case 'play': // 抛球玩耍
      if (energy < 15) {
        actionState = 'sleepy'
        replyText = '小狗累趴啦，需要歇息充充体力~'
        logText = `小狗体力不支，瘫软在地需要休息`
      } else {
        mood = Math.min(MAX_STAT, mood + 25)
        energy = Math.max(0, energy - 15)
        hunger = Math.max(0, hunger - 8)
        exp += 20
        actionState = 'play'
        replyText = '接飞盘成功！小狗快乐地绕着你们打转！'
        logText = `${myName} 和小狗玩起了飞盘接力，心情暴增！`
      }
      break

    case 'gift': // 赠送小玩具/零食
      mood = Math.min(MAX_STAT, mood + 30)
      hunger = Math.min(MAX_STAT, hunger + 15)
      exp += 30
      actionState = 'surprise'
      replyText = '哇塞！收到精致小礼物！开心地转圈圈！'
      logText = `${myName} 送给小狗专属玩具礼盒，小狗欣喜若狂！`
      break

    case 'sleep': // 抱去睡觉恢复体力
      energy = Math.min(MAX_STAT, energy + 40)
      actionState = 'sleepy'
      replyText = '呼噜~ 小狗盖上小被子安稳睡着了 zZ'
      logText = `${myName} 为小狗掖好被角，进入深度美梦`
      break

    case 'poke': // 点击桌面宠物（即时互动）
    default:
      mood = Math.min(MAX_STAT, mood + 5)
      exp += 5
      // 随机触发撒娇或惊喜反应
      actionState = Math.random() > 0.4 ? 'expectant' : 'happy'
      replyText = '汪！尾巴像螺旋桨一样飞速摇动！'
      logText = `${myName} 轻轻戳了戳小狗，小狗开心地扑进怀里`
      break
  }

  // 等级升级计算（每100经验升一级）
  if (exp >= 100) {
    level += Math.floor(exp / 100)
    exp = exp % 100
    replyText += ` 🎉 小狗升级到 Lv.${level} 啦！`
  }

  const updateData = {
    hunger,
    mood,
    energy,
    level,
    exp,
    actionState,
    lastInteractedAt: Date.now(),
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({
    data: updateData
  })

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      action,
      replyText,
      logText
    }
  }
}

// 3. 自定义修改宠物名字
async function petRename(event, ctx) {
  const { OPENID } = ctx
  const { name } = event
  const newName = String(name || '').trim().slice(0, 10)
  if (!newName) throw new Error('名字不能为空')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const res = await db.collection('pets').where({ roomId: me.roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  await db.collection('pets').doc(petDoc._id).update({
    data: {
      name: newName,
      updatedAt: db.serverDate()
    }
  })

  return { code: 0, data: { name: newName } }
}

module.exports = {
  petGet,
  petInteract,
  petRename
}
