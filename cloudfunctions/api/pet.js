// 双人虚拟宠物进化与养成模块
// 核心机制：
// 1. 四大形态阶段：蛋(egg) → 幼崽(baby) → 成长期(youth) → 完全体(adult)
// 2. 双方共享经验池，当日总经验上限（避免比较心理）
// 3. 健康度(health)为总指标（受饱食、心情、清洁、疲劳综合影响），健康度低于 80% 无法进化，外观呈现病态/虚弱
// 4. 进化机制：经验满 + 健康度达标(>=80) + 双方共同确认
// 5. 进化奖励：成功进化后状态全满
// 6. 结合情侣积分系统：新增宠物积分商城（食品、玩具、药品、清洁用品等）

const { db, _, getUserByOpenid, getRoomUsers, cnDateStr } = require('./helpers')
const { deductUser } = require('./transactions')

const MAX_STAT = 100
const HEALTH_THRESHOLD = 80 // 进化必须健康度 >= 80%

// 四大进化阶段设定
const STAGES = {
  egg: {
    key: 'egg',
    name: '萌宠蛋',
    stageIndex: 1,
    maxExp: 100, // 蛋阶段前期最快，几天内可孵化
    dailyExpLimit: 40,
    nextStage: 'baby'
  },
  baby: {
    key: 'baby',
    name: '幼崽期',
    stageIndex: 2,
    maxExp: 300, // 幼崽期中等
    dailyExpLimit: 60,
    nextStage: 'youth'
  },
  youth: {
    key: 'youth',
    name: '成长期',
    stageIndex: 3,
    maxExp: 700, // 成长期较长
    dailyExpLimit: 80,
    nextStage: 'adult'
  },
  adult: {
    key: 'adult',
    name: '完全体',
    stageIndex: 4,
    maxExp: 2000, // 完全体作为长期陪伴目标
    dailyExpLimit: 100,
    nextStage: null
  }
}

// 宠物商店商品配置（使用小程序内双方积分购买）
const PET_SHOP = [
  { id: 'item_meat', name: '极品肉干', price: 15, emoji: '🍖', desc: '饱食+30，经验+15', type: 'food', hunger: 30, mood: 10, exp: 15 },
  { id: 'item_canned', name: '特制金枪鱼罐头', price: 25, emoji: '🥫', desc: '饱食+45，心情+20，经验+25', type: 'food', hunger: 45, mood: 20, exp: 25 },
  { id: 'item_bath', name: '草本香波沐浴露', price: 20, emoji: '🧼', desc: '清洁+50，健康+15，经验+15', type: 'clean', cleanliness: 50, health: 15, exp: 15 },
  { id: 'item_toy', name: '发光飞盘玩具', price: 30, emoji: '🥏', desc: '心情+40，消耗少量体力，经验+30', type: 'toy', mood: 40, energy: -10, exp: 30 },
  { id: 'item_medicine', name: '爱心速效特效药', price: 40, emoji: '💊', desc: '直接恢复40点健康度，去除病态！', type: 'medicine', health: 40, mood: 10, exp: 20 },
  { id: 'item_cake', name: '甜蜜心愿定制蛋糕', price: 60, emoji: '🎂', desc: '饱食+50，心情+50，全属性暴涨！', type: 'special', hunger: 50, mood: 50, health: 25, exp: 40 }
]

const DEFAULT_PET = {
  name: '小糯米',
  stage: 'egg', // 'egg' | 'baby' | 'youth' | 'adult'
  stageIndex: 1,
  hunger: 90,       // 饱食度
  mood: 90,         // 心情值
  cleanliness: 90,  // 清洁度
  energy: 90,       // 体力值
  health: 95,       // 健康度（核心总指标）
  exp: 0,           // 当前阶段经验
  maxExp: STAGES.egg.maxExp,
  todayExp: 0,      // 当日累计经验
  todayExpDate: cnDateStr(),
  actionState: 'normal',
  evolveRequested: false, // 是否有一方已发起进化申请
  evolveRequestBy: '',   // 发起人 openid
  lastInteractedAt: Date.now(),
  lastActionUser: '',
  lastActionText: '萌宠蛋正在温暖的小窝中静静孵化...',
}

// 综合健康度计算与自然属性衰减
function calcDecayedStats(pet) {
  const now = Date.now()
  const lastTime = pet.lastInteractedAt || now
  const elapsedHours = Math.max(0, (now - lastTime) / (3600 * 1000))
  const today = cnDateStr()

  // 检查是否换天，重置当日经验获取
  let todayExp = pet.todayExp || 0
  if (pet.todayExpDate !== today) {
    todayExp = 0
  }

  // 自然消耗
  const hungerDecay = Math.floor(elapsedHours * 2.5)
  const moodDecay = Math.floor(elapsedHours * 2)
  const cleanDecay = Math.floor(elapsedHours * 1.5)

  let hunger = Math.max(0, Math.min(MAX_STAT, (pet.hunger ?? 90) - hungerDecay))
  let mood = Math.max(0, Math.min(MAX_STAT, (pet.mood ?? 90) - moodDecay))
  let cleanliness = Math.max(0, Math.min(MAX_STAT, (pet.cleanliness ?? 90) - cleanDecay))
  let energy = Math.max(0, Math.min(MAX_STAT, (pet.energy ?? 90)))
  let health = pet.health ?? 95

  // 饱食、心情或清洁任一状态过低时，健康度逐渐下降
  if (hunger < 40 || mood < 40 || cleanliness < 40) {
    const healthPenalty = Math.floor(elapsedHours * 2)
    health = Math.max(0, health - Math.max(1, healthPenalty))
  } else if (hunger >= 70 && mood >= 70 && cleanliness >= 70 && elapsedHours >= 1) {
    // 状态全良好时缓慢自然自愈
    health = Math.min(MAX_STAT, health + Math.floor(elapsedHours * 1))
  }

  // 阶段配置
  const curStageConfig = STAGES[pet.stage || 'egg'] || STAGES.egg

  // 确定外观动作状态
  let actionState = pet.actionState || 'normal'
  if (health < 60) {
    actionState = 'sick' // 虚弱病态
  } else if (hunger < 35 || mood < 35) {
    actionState = 'sad' // 委屈难过
  } else if (hunger > 75 && mood > 75 && health >= 80) {
    actionState = 'happy' // 开心满足
  }

  return {
    ...pet,
    stage: curStageConfig.key,
    stageIndex: curStageConfig.stageIndex,
    maxExp: curStageConfig.maxExp,
    hunger,
    mood,
    cleanliness,
    energy,
    health,
    todayExp,
    todayExpDate: today,
    actionState
  }
}

// 1. 获取宠物状态
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

  const updatedPet = calcDecayedStats(petDoc)
  const stageCfg = STAGES[updatedPet.stage] || STAGES.egg

  return {
    code: 0,
    data: {
      pet: updatedPet,
      stageConfig: stageCfg,
      healthThreshold: HEALTH_THRESHOLD,
      canEvolve: updatedPet.exp >= updatedPet.maxExp && updatedPet.health >= HEALTH_THRESHOLD && Boolean(stageCfg.nextStage),
      isWaitingPartnerConfirm: Boolean(updatedPet.evolveRequested && updatedPet.evolveRequestBy !== OPENID),
      isMyRequested: Boolean(updatedPet.evolveRequested && updatedPet.evolveRequestBy === OPENID),
      shopList: PET_SHOP,
      myBalance: me.balance || 0,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar } : null
    }
  }
}

// 2. 日常互动与抚育（抚摸/对话/摇晃/玩耍/休息/看病喂药）
async function petInteract(event, ctx) {
  const { OPENID } = ctx
  const { action = 'touch' } = event // 'touch'(摸/对话/摇晃) | 'clean' | 'sleep' | 'heal'(看病)

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
  const stageCfg = STAGES[current.stage] || STAGES.egg
  let { hunger, mood, cleanliness, energy, health, exp, todayExp, actionState } = current
  let logText = ''
  let replyText = ''
  let gainedExp = 0
  const myName = me.nickname || '宝宝'

  // 计算今日经验上限
  const limit = stageCfg.dailyExpLimit
  const calcAddExp = (amount) => {
    if (todayExp >= limit) return 0
    const canAdd = Math.min(amount, limit - todayExp)
    todayExp += canAdd
    return canAdd
  }

  if (current.stage === 'egg') {
    // 蛋阶段：专属互动（抚摸暖蛋、温柔对话、轻微摇晃）
    if (action === 'touch') {
      gainedExp = calcAddExp(12)
      mood = Math.min(MAX_STAT, mood + 15)
      health = Math.min(MAX_STAT, health + 5)
      actionState = 'expectant'
      replyText = '蛋壳微微发热摇晃了一下，小生命感受到了你们的爱！'
      logText = `${myName} 温柔抚摸了蛋壳，温度暖洋洋的`
    } else if (action === 'talk') {
      gainedExp = calcAddExp(15)
      mood = Math.min(MAX_STAT, mood + 20)
      actionState = 'happy'
      replyText = '轻轻和蛋蛋说悄悄话，里面传出了微弱的心跳声~'
      logText = `${myName} 俯身对蛋蛋说了甜蜜的情话`
    } else if (action === 'shake') {
      gainedExp = calcAddExp(10)
      energy = Math.max(0, energy - 5)
      actionState = 'surprise'
      replyText = '轻晃蛋蛋！里面的小萌宠在好奇地翻身呢~'
      logText = `${myName} 轻轻摇晃了蛋蛋，期待它的破壳`
    }
  } else {
    // 幼崽、成长期、完全体阶段互动
    switch (action) {
      case 'touch': // 抚摸/互动
        gainedExp = calcAddExp(10)
        mood = Math.min(MAX_STAT, mood + 15)
        actionState = health < 60 ? 'sick' : 'expectant'
        replyText = '呼噜呼噜~ 小家伙舒服地眯起眼睛，蹭了蹭你！'
        logText = `${myName} 温柔抚摸了宠物，心情变好啦`
        break

      case 'clean': // 清洁/洗澡
        gainedExp = calcAddExp(12)
        cleanliness = Math.min(MAX_STAT, cleanliness + 35)
        health = Math.min(MAX_STAT, health + 10)
        actionState = 'happy'
        replyText = '洗香香啦！泡沫洗掉污垢，变得干干净净！'
        logText = `${myName} 给宠物洗了个舒舒服服的泡泡澡`
        break

      case 'sleep': // 休息恢复
        energy = Math.min(MAX_STAT, energy + 40)
        health = Math.min(MAX_STAT, health + 8)
        actionState = 'sleepy'
        replyText = '呼噜呼噜... 盖上小被子安稳进入美梦 zZ'
        logText = `${myName} 哄宠物安静入睡，体力迅速恢复`
        break

      case 'heal': // 看病治疗（任意一方均可单独完成）
        health = Math.min(MAX_STAT, health + 30)
        mood = Math.min(MAX_STAT, mood + 10)
        actionState = 'normal'
        replyText = '细心包扎并贴上爱心创口贴，健康度恢复，活力归来！'
        logText = `${myName} 贴心为宠物看病包扎，健康度回升`
        break

      default:
        gainedExp = calcAddExp(5)
        mood = Math.min(MAX_STAT, mood + 5)
        actionState = 'happy'
        replyText = '汪！尾巴欢快地摇摆！'
        logText = `${myName} 和小宠物开心地玩耍了一会儿`
        break
    }
  }

  // 累积经验并判断是否可进化
  exp = Math.min(current.maxExp, exp + gainedExp)
  if (gainedExp > 0) {
    replyText += ` (经验+${gainedExp})`
  } else if (todayExp >= limit) {
    replyText += ` (今日经验已达上限)`
  }

  const updateData = {
    hunger,
    mood,
    cleanliness,
    energy,
    health,
    exp,
    todayExp,
    actionState,
    lastInteractedAt: Date.now(),
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      replyText,
      logText,
      gainedExp
    }
  }
}

// 3. 积分商城购买道具并使用（扣减情侣用户个人积分，增加饱食/清洁/健康等）
async function petBuyItem(event, ctx) {
  const { OPENID } = ctx
  const { itemId } = event
  const item = PET_SHOP.find(i => i.id === itemId)
  if (!item) throw new Error('道具不存在')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  if ((me.balance || 0) < item.price) {
    throw new Error(`积分不足，需要 ${item.price} 积分（当前余额: ${me.balance || 0}）`)
  }

  const roomId = me.roomId
  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  // 1. 先扣减用户的积分并记流水
  await deductUser(me, item.price, 'pet_shop', `宠物商城购买【${item.name}】`, me.nickname, OPENID)

  // 2. 给宠物增加对应属性
  const current = calcDecayedStats(petDoc)
  const stageCfg = STAGES[current.stage] || STAGES.egg
  let { hunger, mood, cleanliness, energy, health, exp, todayExp } = current

  if (item.hunger) hunger = Math.min(MAX_STAT, hunger + item.hunger)
  if (item.mood) mood = Math.min(MAX_STAT, mood + item.mood)
  if (item.cleanliness) cleanliness = Math.min(MAX_STAT, cleanliness + item.cleanliness)
  if (item.energy) energy = Math.max(0, Math.min(MAX_STAT, energy + item.energy))
  if (item.health) health = Math.min(MAX_STAT, health + item.health)

  // 增加经验
  const limit = stageCfg.dailyExpLimit
  let addExp = 0
  if (item.exp && todayExp < limit) {
    addExp = Math.min(item.exp, limit - todayExp)
    todayExp += addExp
    exp = Math.min(current.maxExp, exp + addExp)
  }

  const actionState = health < 60 ? 'sick' : (item.type === 'special' ? 'surprise' : 'happy')
  const myName = me.nickname || '宝宝'
  const logText = `${myName} 购买并使用了【${item.name}】`

  const updateData = {
    hunger,
    mood,
    cleanliness,
    energy,
    health,
    exp,
    todayExp,
    actionState,
    lastInteractedAt: Date.now(),
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  // 读取最新余额
  const freshMe = await getUserByOpenid(OPENID)

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      myBalance: freshMe.balance || 0,
      replyText: `成功使用【${item.name}】！${item.desc}`,
      logText
    }
  }
}

// 4. 发起进化申请（单方在经验满+健康达标时发起）
async function petRequestEvolve(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  const stageCfg = STAGES[current.stage] || STAGES.egg

  if (!stageCfg.nextStage) {
    throw new Error('宠物已经是完全体终极形态啦！')
  }
  if (current.exp < current.maxExp) {
    throw new Error('经验值尚未蓄满，继续陪伴成长吧！')
  }
  if (current.health < HEALTH_THRESHOLD) {
    throw new Error(`健康度当前仅为 ${current.health}%，需照料至 ${HEALTH_THRESHOLD}% 以上方可蜕变进化！`)
  }

  const myName = me.nickname || '宝宝'
  const updateData = {
    evolveRequested: true,
    evolveRequestBy: OPENID,
    lastActionText: `${myName} 已经发起了进化仪式！等待另一半共同见证...`,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      msg: '已发起进化邀请！等待 TA 确认共同见证蜕变瞬间！'
    }
  }
}

// 5. 确认进化（另一方确认，完成形态蜕变，奖励状态全满！）
async function petConfirmEvolve(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  const stageCfg = STAGES[current.stage] || STAGES.egg
  const nextStageKey = stageCfg.nextStage

  if (!nextStageKey) throw new Error('已经是完全体了')
  if (!current.evolveRequested) throw new Error('尚未发起进化仪式')

  const roomUsers = await getRoomUsers(roomId)
  const isSolo = roomUsers.length <= 1

  // 如果双人模式，必须由另一方确认（防止自己发起自己秒确认）
  if (!isSolo && current.evolveRequestBy === OPENID) {
    throw new Error('请等待 TA 点击确认，共同完成进化仪式哦~')
  }

  const nextStageCfg = STAGES[nextStageKey]
  const myName = me.nickname || '宝宝'

  // 阶段进化奖励：所有状态全部重置为 100 满值！
  const evolveData = {
    stage: nextStageKey,
    stageIndex: nextStageCfg.stageIndex,
    maxExp: nextStageCfg.maxExp,
    exp: 0,
    hunger: 100,
    mood: 100,
    cleanliness: 100,
    energy: 100,
    health: 100,
    actionState: 'surprise',
    evolveRequested: false,
    evolveRequestBy: '',
    lastActionUser: myName,
    lastActionText: `🎉 双方共同见证！成功破茧蜕变为【${nextStageCfg.name}】！`,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: evolveData })

  return {
    code: 0,
    data: {
      pet: { ...current, ...evolveData },
      stageConfig: nextStageCfg,
      congratulationText: `🎉 恭喜！萌宠成功进化至【${nextStageCfg.name}】！全属性已恢复满格奖励！`
    }
  }
}

// 6. 重命名
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
  petBuyItem,
  petRequestEvolve,
  petConfirmEvolve,
  petRename
}
