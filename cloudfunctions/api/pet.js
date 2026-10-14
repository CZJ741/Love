// 双人虚拟宠物进化与养成模块 —— 金币与沉浸小窝生态
// 核心机制：
// 1. 彻底与情侣积分剥离，引入双人共享金库：萌宠金币 (coins)；每日小游戏产币上限 (DAILY_COIN_LIMIT = 150)
// 2. 储物箱背包系统 (inventory) + 五大插槽无耐久永久家具 (slots: rug/bed/wall/window/facility)
// 3. 生活保障机制：自动喂食/水机作为 facility 家具自动保底饱食度，出差/忙碌防衰减托管卡
// 4. 单机第三人称小游戏赚币结算：掉体力与清洁，过量时掉健康并受限

const { db, _, getUserByOpenid, getRoomUsers, cnDateStr } = require('./helpers')
const { checkText } = require('./secCheck')

const MAX_STAT = 100
const HEALTH_THRESHOLD = 80 // 进化必须健康度 >= 80%
const DAILY_COIN_LIMIT = 150 // 每日小游戏赚币上限

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

// 萌宠百货商店配置（纯金币购买，食物/洗浴消耗品进储物箱，家具永久拥有）
const PET_SHOP = [
  // 饮食生活消耗品
  { id: 'item_meat', name: '极品肉干', price: 15, emoji: '🍖', desc: '饱食+30，经验+15', type: 'consumable', cat: 'food', hunger: 30, mood: 10, exp: 15 },
  { id: 'item_canned', name: '金枪鱼罐头', price: 25, emoji: '🥫', desc: '饱食+45，心情+20，经验+25', type: 'consumable', cat: 'food', hunger: 45, mood: 20, exp: 25 },
  { id: 'item_cake', name: '定制奶油蛋糕', price: 50, emoji: '🎂', desc: '饱食+50，心情+50，健康+20', type: 'consumable', cat: 'food', hunger: 50, mood: 50, health: 20, exp: 35 },
  { id: 'item_milk', name: '暖暖羊奶布丁', price: 20, emoji: '🍮', desc: '饱食+25，心情+30，经验+15', type: 'consumable', cat: 'food', hunger: 25, mood: 30, exp: 15 },
  { id: 'item_strawberry', name: '鲜甜草莓大福', price: 30, emoji: '🍓', desc: '心情+40，饱食+20，体力+15', type: 'consumable', cat: 'food', mood: 40, hunger: 20, energy: 15, exp: 20 },

  // 洗浴与个护
  { id: 'item_soap', name: '草本香波肥皂', price: 15, emoji: '🧼', desc: '清洁+40，健康+10，经验+10', type: 'consumable', cat: 'clean', cleanliness: 40, health: 10, exp: 10 },
  { id: 'item_bath', name: '奢华泡泡浴球', price: 30, emoji: '🛁', desc: '清洁+70，健康+25，心情+25', type: 'consumable', cat: 'clean', cleanliness: 70, health: 25, mood: 25, exp: 25 },
  { id: 'item_brush', name: '顺滑绒毛按摩刷', price: 35, emoji: '🪮', desc: '清洁+50，心情+40，体力+20', type: 'consumable', cat: 'clean', cleanliness: 50, mood: 40, energy: 20, exp: 20 },
  { id: 'item_medicine', name: '速效爱心药水', price: 40, emoji: '💊', desc: '恢复45健康度，祛除病态虚弱', type: 'consumable', cat: 'medicine', health: 45, mood: 10, exp: 20 },

  // 生活保障道具
  { id: 'item_protect_card', name: '出差免衰减托管卡', price: 80, emoji: '🛡️', desc: '激活后3天内宠物属性全冻结不自然衰减', type: 'consumable', cat: 'insurance', durationDays: 3 },
  { id: 'item_protect_card_week', name: '7天长期度假守护卡', price: 160, emoji: '🏖️', desc: '激活后7天内宠物无忧无虑全冻结不衰减', type: 'consumable', cat: 'insurance', durationDays: 7 },

  // 五大插槽永久家具（无耐久）
  // 1. 地毯 (rug)
  { id: 'furn_rug_pink', name: '粉色客厅地毯', price: 60, emoji: '🌸', desc: '柔软温馨的客厅地毯', type: 'furniture', slot: 'rug', scene: 'living' },
  { id: 'furn_rug_bear', name: '小熊卧室地垫', price: 90, emoji: '🧸', desc: '治愈手作小熊地垫', type: 'furniture', slot: 'rug', scene: 'bedroom' },
  { id: 'furn_rug_star', name: '星空露营毯', price: 110, emoji: '🌌', desc: '适合户外休憩的星空毯', type: 'furniture', slot: 'rug', scene: 'outdoor' },

  // 2. 睡窝 (bed)
  { id: 'furn_bed_cloud', name: '云朵卧室软窝', price: 80, emoji: '☁️', desc: '如坠云端的睡窝', type: 'furniture', slot: 'bed', scene: 'bedroom' },
  { id: 'furn_bed_castle', name: '城堡卧室床', price: 120, emoji: '🏰', desc: '精致梦幻宠物城堡睡榻', type: 'furniture', slot: 'bed', scene: 'bedroom' },
  { id: 'furn_bed_moon', name: '月亮摇篮床', price: 140, emoji: '🌙', desc: '微光摇曳的弯月摇篮', type: 'furniture', slot: 'bed', scene: 'bedroom' },

  // 3. 墙饰 (wall)
  { id: 'furn_wall_lights', name: '客厅星星灯串', price: 50, emoji: '✨', desc: '夜间静谧暖光墙壁灯', type: 'furniture', slot: 'wall', scene: 'living' },
  { id: 'furn_wall_frame', name: '客厅纪念相框', price: 75, emoji: '🖼️', desc: '悬挂小窝甜蜜瞬间', type: 'furniture', slot: 'wall', scene: 'living' },
  { id: 'furn_wall_clock', name: '客厅木挂钟', price: 85, emoji: '🕰️', desc: '复古温馨的木雕挂钟', type: 'furniture', slot: 'wall', scene: 'living' },

  // 4. 窗台/植物 (window)
  { id: 'furn_win_sunflower', name: '阳台向日葵', price: 45, emoji: '🌻', desc: '迎着阳光绽放的绿植', type: 'furniture', slot: 'window', scene: 'outdoor' },
  { id: 'furn_win_cherry', name: '卧室樱花风铃', price: 70, emoji: '🎐', desc: '微风轻拂飘落樱花', type: 'furniture', slot: 'window', scene: 'bedroom' },
  { id: 'furn_win_catgrass', name: '浴室薄荷盆栽', price: 55, emoji: '🪴', desc: '散发清新淡雅香气的绿植', type: 'furniture', slot: 'window', scene: 'bathroom' },

  // 5. 生活保障机 (facility)
  { id: 'furn_fac_feeder', name: '客厅恒温双食盆', price: 100, emoji: '🥣', desc: '自动保底：饱食度不低于35%', type: 'furniture', slot: 'facility', scene: 'living' },
  { id: 'furn_fac_fountain', name: '浴室活水饮水机', price: 150, emoji: '⛲', desc: '顶配保障：饱食与清洁均保底45%', type: 'furniture', slot: 'facility', scene: 'bathroom' },
  { id: 'furn_fac_robot', name: '户外管家机器人', price: 220, emoji: '🤖', desc: '全能保底：饱食、清洁与心情均保底50%', type: 'furniture', slot: 'facility', scene: 'outdoor' },
  { id: 'furn_living_sofa', name: '客厅双人沙发', price: 180, emoji: '🛋️', desc: '柔软的双人休息沙发', type: 'furniture', slot: 'sofa', scene: 'living' },
  { id: 'furn_living_table', name: '客厅茶几', price: 95, emoji: '🪵', desc: '摆放茶点的小茶几', type: 'furniture', slot: 'table', scene: 'living' },
  { id: 'furn_bedroom_lamp', name: '卧室暖光床头灯', price: 85, emoji: '🛋️', desc: '睡前陪伴的柔和灯光', type: 'furniture', slot: 'lamp', scene: 'bedroom' },
  { id: 'furn_bath_tub', name: '泡泡浴缸', price: 200, emoji: '🛁', desc: '装满泡泡的宠物浴缸', type: 'furniture', slot: 'tub', scene: 'bathroom' },
  { id: 'furn_bath_mat', name: '浴室防滑垫', price: 65, emoji: '🧼', desc: '柔软吸水的防滑脚垫', type: 'furniture', slot: 'mat', scene: 'bathroom' },
  { id: 'furn_outdoor_tent', name: '星空露营帐篷', price: 190, emoji: '⛺', desc: '周末户外露营小帐篷', type: 'furniture', slot: 'tent', scene: 'outdoor' },
  { id: 'furn_outdoor_tree', name: '花园大树', price: 130, emoji: '🌳', desc: '为花园添一片清凉树荫', type: 'furniture', slot: 'tree', scene: 'outdoor' }
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
  coins: 100,       // 初始共享金币
  todayCoins: 0,    // 当日小游戏赚币总额
  todayCoinsDate: cnDateStr(),
  actionState: 'normal',
  evolveRequested: false, // 是否有一方已发起进化申请
  evolveRequestBy: '',   // 发起人 openid
  lastInteractedAt: Date.now(),
  lastActionUser: '',
  lastActionText: '萌宠蛋正在温暖的小窝中静静孵化...',
  footprints: [],    // 双人抚育足迹流水
  // 储物箱背包物品列表 [{ id, count, type, slot }]
  inventory: [
    { id: 'item_meat', count: 2, type: 'consumable', cat: 'food' },
    { id: 'item_soap', count: 1, type: 'consumable', cat: 'clean' }
  ],
  // 五大插槽当前装备家具ID
  slots: {
    rug: '',
    bed: '',
    wall: '',
    window: '',
    facility: '',
    scene: 'living'
  },
  // 保障托管状态
  freezeUntil: 0 // 托管截止时间戳
}

// 综合健康度计算、自动喂食器保底与自然属性衰减
function calcDecayedStats(pet) {
  const now = Date.now()
  const lastTime = pet.lastInteractedAt || now
  const elapsedHours = Math.max(0, (now - lastTime) / (3600 * 1000))
  const today = cnDateStr()

  // 检查是否换天，重置当日经验与小游戏金币上限
  let todayExp = pet.todayExp || 0
  if (pet.todayExpDate !== today) {
    todayExp = 0
  }

  let todayCoins = pet.todayCoins || 0
  if (pet.todayCoinsDate !== today) {
    todayCoins = 0
  }

  // 检查是否处于出差托管免衰减保护期
  const isProtected = pet.freezeUntil && pet.freezeUntil > now

  let hunger = pet.hunger ?? 90
  let mood = pet.mood ?? 90
  let cleanliness = pet.cleanliness ?? 90
  let energy = pet.energy ?? 90
  let health = pet.health ?? 95

  if (!isProtected) {
    // 自然消耗
    const hungerDecay = Math.floor(elapsedHours * 2.5)
    const moodDecay = Math.floor(elapsedHours * 2)
    const cleanDecay = Math.floor(elapsedHours * 1.5)

    hunger = Math.max(0, Math.min(MAX_STAT, hunger - hungerDecay))
    mood = Math.max(0, Math.min(MAX_STAT, mood - moodDecay))
    cleanliness = Math.max(0, Math.min(MAX_STAT, cleanliness - cleanDecay))
  }

  // 自然恢复体力
  if (elapsedHours > 0.5) {
    energy = Math.min(MAX_STAT, energy + Math.floor(elapsedHours * 8))
  }

  // 生活保障家具自动兜底机制（无需消耗粮食）
  const facilitySlot = (pet.slots && pet.slots.facility) || ''
  if (facilitySlot === 'furn_fac_feeder') {
    if (hunger < 35) hunger = 35 // 自动保底饱食度
  } else if (facilitySlot === 'furn_fac_fountain') {
    if (hunger < 45) hunger = 45 // 顶配自动保底饱食
    if (cleanliness < 45) cleanliness = 45 // 顶配活水保底清洁
  } else if (facilitySlot === 'furn_fac_robot') {
    if (hunger < 50) hunger = 50 // 管家保底饱食
    if (cleanliness < 50) cleanliness = 50 // 管家保底清洁
    if (mood < 50) mood = 50 // 管家保底心情
  }

  // 饱食、心情或清洁任一状态过低时，健康度逐渐下降
  if (!isProtected) {
    if (hunger < 40 || mood < 40 || cleanliness < 40) {
      const healthPenalty = Math.floor(elapsedHours * 2)
      health = Math.max(0, health - healthPenalty)
    } else if (hunger >= 70 && mood >= 70 && cleanliness >= 70 && elapsedHours >= 1) {
      // 状态全良好时缓慢自然自愈
      health = Math.min(MAX_STAT, health + Math.floor(elapsedHours * 1))
    }
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
    todayCoins,
    todayCoinsDate: today,
    actionState,
    coins: pet.coins !== undefined ? pet.coins : 100,
    slots: pet.slots || DEFAULT_PET.slots,
    inventory: pet.inventory || DEFAULT_PET.inventory
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
      dailyCoinLimit: DAILY_COIN_LIMIT,
      me: { openid: me.openid, nickname: me.nickname, avatar: me.avatar },
      partner: partner ? { openid: partner.openid, nickname: partner.nickname, avatar: partner.avatar } : null
    }
  }
}

// 2. 日常互动与抚育（抚摸/对话/摇晃/玩耍/休息/看病喂药）
async function petInteract(event, ctx) {
  const { OPENID } = ctx
  // 兼容 petAction / subAction / action，彻底避免前端路由顶层 action 字段被覆盖
  const requestedAction = event.petAction || event.subAction || event.actionType || event.action || 'touch'
  const action = requestedAction === 'poke' ? 'touch' : requestedAction

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
      case 'feed': // 免费日常投喂
        gainedExp = calcAddExp(10)
        hunger = Math.min(MAX_STAT, hunger + 25)
        mood = Math.min(MAX_STAT, mood + 10)
        actionState = health < 60 ? 'sick' : 'happy'
        replyText = '吧唧吧唧~ 享受着美味口粮，满足地舔了舔嘴巴！'
        logText = `${myName} 投喂了香脆小饼干，肚子饱饱啦`
        break

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

  // 追加双人抚育足迹（保留最近 15 条）
  const footprints = (current.footprints || []).slice(0, 14)
  footprints.unshift({
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user: myName,
    action,
    text: logText,
    time: Date.now()
  })

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
    footprints,
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

// 3. 萌宠金币商城购买道具/家具（扣减共享金币，放入背包或解锁家具）
async function petBuyItem(event, ctx) {
  const { OPENID } = ctx
  const { itemId } = event
  const item = PET_SHOP.find(i => i.id === itemId)
  if (!item) throw new Error('商品不存在')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId
  if (!roomId) throw new Error('未加入小窝')

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  if ((current.coins || 0) < item.price) {
    throw new Error(`金币不足，需要 ${item.price} 萌宠金币（当前共享金币: ${current.coins || 0}）`)
  }

  const inventory = (current.inventory || []).slice()
  const existingIdx = inventory.findIndex(inv => inv.id === item.id)

  if (item.type === 'furniture') {
    if (existingIdx !== -1) {
      throw new Error('此件家具已拥有，无需重复购买！')
    }
    inventory.push({ id: item.id, type: 'furniture', slot: item.slot })
  } else {
    // 消耗品入背包堆叠
    if (existingIdx !== -1) {
      inventory[existingIdx].count = (inventory[existingIdx].count || 1) + 1
    } else {
      inventory.push({ id: item.id, count: 1, type: 'consumable', cat: item.cat })
    }
  }

  const newCoins = (current.coins || 0) - item.price
  const myName = me.nickname || '宝宝'
  const logText = `${myName} 购买了【${item.name}】放入储物箱`

  const footprints = (current.footprints || []).slice(0, 14)
  footprints.unshift({
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user: myName,
    action: 'shop',
    text: logText,
    time: Date.now()
  })

  const updateData = {
    coins: newCoins,
    inventory,
    footprints,
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      replyText: `已购买【${item.name}】放入储物箱！`,
      logText
    }
  }
}

// 4. 从储物箱背包使用道具 (消耗品 / 托管卡)
async function petUseItem(event, ctx) {
  const { OPENID } = ctx
  const { itemId } = event
  const itemConfig = PET_SHOP.find(i => i.id === itemId)
  if (!itemConfig) throw new Error('道具不存在')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  const inventory = (current.inventory || []).slice()
  const itemIdx = inventory.findIndex(i => i.id === itemId)
  if (itemIdx === -1 || (inventory[itemIdx].count || 0) <= 0) {
    throw new Error('储物箱中暂无此道具，可前往商店采购~')
  }

  // 扣除背包数量
  inventory[itemIdx].count -= 1
  if (inventory[itemIdx].count <= 0) {
    inventory.splice(itemIdx, 1)
  }

  let { hunger, mood, cleanliness, energy, health, exp, todayExp, actionState, freezeUntil } = current
  const stageCfg = STAGES[current.stage] || STAGES.egg
  const limit = stageCfg.dailyExpLimit
  const calcAddExp = (amount) => {
    if (todayExp >= limit) return 0
    const canAdd = Math.min(amount, limit - todayExp)
    todayExp += canAdd
    return canAdd
  }

  const myName = me.nickname || '宝宝'
  let logText = ''

  if (itemConfig.cat === 'insurance') {
    const now = Date.now()
    const currentFreeze = freezeUntil && freezeUntil > now ? freezeUntil : now
    freezeUntil = currentFreeze + (itemConfig.durationDays || 3) * 24 * 3600 * 1000
    logText = `${myName} 开启了【出差免衰减托管】保障`
  } else {
    if (itemConfig.hunger) hunger = Math.min(MAX_STAT, hunger + itemConfig.hunger)
    if (itemConfig.mood) mood = Math.min(MAX_STAT, mood + itemConfig.mood)
    if (itemConfig.cleanliness) cleanliness = Math.min(MAX_STAT, cleanliness + itemConfig.cleanliness)
    if (itemConfig.energy) energy = Math.max(0, Math.min(MAX_STAT, energy + itemConfig.energy))
    if (itemConfig.health) health = Math.min(MAX_STAT, health + itemConfig.health)
    if (itemConfig.exp) exp += calcAddExp(itemConfig.exp)
    actionState = 'happy'
    logText = `${myName} 从储物箱拿出【${itemConfig.name}】投喂/照料了小萌宠`
  }

  const footprints = (current.footprints || []).slice(0, 14)
  footprints.unshift({
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user: myName,
    action: 'use',
    text: logText,
    time: Date.now()
  })

  const updateData = {
    hunger,
    mood,
    cleanliness,
    energy,
    health,
    exp,
    todayExp,
    actionState,
    freezeUntil: freezeUntil || 0,
    inventory,
    footprints,
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
      replyText: `使用了【${itemConfig.name}】！${itemConfig.desc}`,
      logText
    }
  }
}

// 5. 插槽家具更换与装备穿戴
async function petEquipSlot(event, ctx) {
  const { OPENID } = ctx
  const { slot, itemId } = event // 传统插槽、场景选择或 scene_<scene>_<slot>
  const validSlots = ['rug', 'bed', 'wall', 'window', 'facility']
  const sceneSlotMatch = /^scene_(living|bedroom|bathroom|outdoor)_(sofa|table|lamp|tub|mat|tent|tree)$/.exec(slot || '')
  const isSceneFurnitureSlot = Boolean(sceneSlotMatch)
  const isSceneSelection = slot === 'scene'
  if (!validSlots.includes(slot) && !isSceneFurnitureSlot && !isSceneSelection) throw new Error('无效的家具插槽')
  if (isSceneSelection && !['living', 'bedroom', 'bathroom', 'outdoor'].includes(itemId)) throw new Error('无效的场景')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  const inventory = current.inventory || []

  if (itemId && !isSceneSelection) {
    const itemConfig = PET_SHOP.find(item => item.id === itemId)
    const hasItem = inventory.some(i => i.id === itemId && i.type === 'furniture')
      && itemConfig
      && (isSceneFurnitureSlot
        ? itemConfig.slot === sceneSlotMatch[2] && itemConfig.scene === sceneSlotMatch[1]
        : itemConfig.slot === slot)
    if (!hasItem) throw new Error('储物箱中未拥有该插槽家具')
  }

  const slots = { ...(current.slots || DEFAULT_PET.slots), [slot]: itemId || '' }
  if (isSceneFurnitureSlot) {
    const matchingItem = PET_SHOP.find(item => item.id === itemId)
    if (!matchingItem) throw new Error('家具不存在')
    slots.scene = sceneSlotMatch[1]
  }
  const myName = me.nickname || '宝宝'
  const itemConfig = itemId ? PET_SHOP.find(i => i.id === itemId) : null
  const logText = isSceneSelection
    ? `切换到了${['living', 'bedroom', 'bathroom', 'outdoor'].find(scene => scene === itemId) === 'living' ? '客厅' : itemId === 'bedroom' ? '卧室' : itemId === 'bathroom' ? '卫生间' : '室外'}`
    : itemId
      ? `${myName} 为${itemConfig && itemConfig.scene === 'bathroom' ? '卫生间' : itemConfig && itemConfig.scene === 'outdoor' ? '室外' : itemConfig && itemConfig.scene === 'bedroom' ? '卧室' : '客厅'}摆放了【${itemConfig ? itemConfig.name : '新装饰'}】`
      : `${myName} 卸下了装饰`

  const footprints = (current.footprints || []).slice(0, 14)
  footprints.unshift({
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user: myName,
    action: 'equip',
    text: logText,
    time: Date.now()
  })

  const updateData = {
    slots,
    footprints,
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  return {
    code: 0,
    data: {
      pet: { ...current, ...updateData },
      logText
    }
  }
}

// 6. 单机第三人称小游戏赚金币结算
async function petGameFinish(event, ctx) {
  const { OPENID } = ctx
  const { score, gameType } = event // score: 游戏得分
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')
  const roomId = me.roomId

  const res = await db.collection('pets').where({ roomId }).limit(1).get()
  const petDoc = res.data[0]
  if (!petDoc) throw new Error('宠物不存在')

  const current = calcDecayedStats(petDoc)
  let { energy, cleanliness, health, coins, todayCoins, todayCoinsDate } = current

  // 计算本局根据表现产出的金币 (5 ~ 20 之间)
  const earnedRaw = Math.min(20, Math.max(5, Math.floor((Number(score) || 0) / 10)))
  const remainingDaily = Math.max(0, DAILY_COIN_LIMIT - todayCoins)
  const actualCoins = Math.min(earnedRaw, remainingDaily)

  // 玩游戏正常消耗：-8体力，-5清洁
  const isExhausted = energy < 20 // 体力过低属于过量/疲劳游戏
  energy = Math.max(0, energy - 8)
  cleanliness = Math.max(0, cleanliness - 5)

  let healthPenalty = 0
  if (isExhausted) {
    // 疲劳过量游戏：扣除健康度
    healthPenalty = 6
    health = Math.max(0, health - healthPenalty)
  }

  todayCoins += actualCoins
  coins += actualCoins

  const myName = me.nickname || '宝宝'
  const logText = `${myName} 操控小萌宠通关小游戏，赚取 +${actualCoins} 萌宠金币！`

  const updateData = {
    energy,
    cleanliness,
    health,
    coins,
    todayCoins,
    todayCoinsDate,
    lastInteractedAt: Date.now(),
    lastActionUser: myName,
    lastActionText: logText,
    updatedAt: db.serverDate()
  }

  await db.collection('pets').doc(petDoc._id).update({ data: updateData })

  return {
    code: 0,
    data: {
      earnedCoins: actualCoins,
      totalCoins: coins,
      isExhausted,
      healthPenalty,
      dailyRemaining: Math.max(0, DAILY_COIN_LIMIT - todayCoins),
      pet: { ...current, ...updateData }
    }
  }
}

// 7. 发起进化申请（单方在经验满+健康达标时发起）
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
  const logText = `🎉 共同见证蜕变为【${nextStageCfg.name}】！`

  const footprints = (current.footprints || []).slice(0, 14)
  footprints.unshift({
    id: 'fp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    user: myName,
    action: 'evolve',
    text: logText,
    time: Date.now()
  })

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
    lastActionText: logText,
    footprints,
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
  await checkText(newName, { openid: OPENID, scene: 1 })

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

// 7. 【开发者模式】测试与快速切换阶段/状态（调试完成后可随时取消）
async function petDevSet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('用户不存在')

  const { stage, health, hunger, mood, cleanliness, energy, exp, actionState, coins, coinsDelta } = event
  const updateData = { updatedAt: db.serverDate() }

  if (stage && STAGES[stage]) {
    const stageCfg = STAGES[stage]
    updateData.stage = stageCfg.key
    updateData.stageIndex = stageCfg.stageIndex
    updateData.maxExp = stageCfg.maxExp
    updateData.evolveRequested = false
    updateData.evolveRequestBy = ''
  }
  if (health !== undefined) updateData.health = Math.max(0, Math.min(100, Number(health)))
  if (hunger !== undefined) updateData.hunger = Math.max(0, Math.min(100, Number(hunger)))
  if (mood !== undefined) updateData.mood = Math.max(0, Math.min(100, Number(mood)))
  if (cleanliness !== undefined) updateData.cleanliness = Math.max(0, Math.min(100, Number(cleanliness)))
  if (energy !== undefined) updateData.energy = Math.max(0, Math.min(100, Number(energy)))
  if (exp !== undefined) updateData.exp = Number(exp)
  if (coins !== undefined) updateData.coins = Number(coins)
  if (coinsDelta !== undefined) {
    const delta = Number(coinsDelta)
    if (!Number.isFinite(delta)) throw new Error('金币增量无效')
    const petRes = await db.collection('pets').where({ roomId: me.roomId }).limit(1).get()
    const petDoc = petRes.data[0]
    if (!petDoc) throw new Error('宠物不存在')
    updateData.coins = (petDoc.coins !== undefined ? Number(petDoc.coins) : 100) + delta
  }
  if (actionState !== undefined) updateData.actionState = actionState

  updateData.lastInteractedAt = Date.now()

  await db.collection('pets').where({ roomId: me.roomId }).update({ data: updateData })
  const fresh = await db.collection('pets').where({ roomId: me.roomId }).limit(1).get()

  return {
    code: 0,
    msg: '开发者模式已生效',
    data: calcDecayedStats(fresh.data[0])
  }
}

module.exports = {
  petGet,
  petInteract,
  petBuyItem,
  petUseItem,
  petEquipSlot,
  petGameFinish,
  petRequestEvolve,
  petConfirmEvolve,
  petRename,
  petDevSet,
}
