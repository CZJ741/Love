// 全局常量：加分/扣分理由、盲盒任务、商城商品等
// 注意：商城商品与盲盒任务需与云函数 cloudfunctions/api 中的保持一致

// 加分事由
const ADD_REASONS = [
  '今天特别乖', '主动做家务', '给我买好吃的', '哄我开心', '陪我逛街',
  '说早安晚安', '帮我按摩', '陪我散步', '送我小礼物', '给我买奶茶',
  '做顿饭给我吃', '超贴心', '按时睡觉', '主动报备行踪', '秒回消息',
  '认真听我说话', '包容我的小脾气', '主动洗碗', '生病贴心照顾',
]

// 扣分事由
const DEDUCT_REASONS = [
  '惹我生气了', '忘记说晚安', '打游戏不理我', '约会迟到', '没回消息',
  '不陪我', '说好的事忘了', '态度敷衍', '又熬夜', '说话不算话',
  '不听话', '消息已读乱回', '不好好吃三餐', '偷偷抽烟/喝酒', '冷暴力不说话',
  '弄丢东西', '忘记纪念日',
]

// 碎片盲盒每日任务
const BLIND_BOX_TASKS = [
  '亲一下', '倒杯水', '夸我一句', '捶捶背', '抱抱30秒', '讲个笑话',
  '喂我一口好吃的', '帮我揉揉肩', '叫我起床', '唱首歌给我听', '跳支舞', '拍一张合照',
]

// 即刻兑换商城
const MALL_ITEMS = [
  { id: 'm1', name: '奶茶一杯', price: 30, emoji: '🧋', desc: '安排一杯奶茶' },
  { id: 'm2', name: '按摩30分钟', price: 40, emoji: '💆', desc: '专业级按摩服务' },
  { id: 'm3', name: '背我上楼', price: 50, emoji: '🏃', desc: '传说级背背' },
  { id: 'm4', name: '看一场电影', price: 80, emoji: '🎬', desc: '手牵手看电影' },
  { id: 'm5', name: '烛光晚餐', price: 150, emoji: '🕯️', desc: '一顿浪漫晚餐' },
  { id: 'm6', name: '周末短途游', price: 300, emoji: '🌊', desc: '一起去远方' },
]

const BONUS_RATE = 0.3 // 动态汇率：付出奖励比例
const SIGN_BASE = 10 // 每日签到基础分
const BLIND_BOX_REWARD = 20 // 盲盒任务奖励

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

  // 新增场景家具
  { id: 'furn_living_sofa', name: '客厅双人沙发', price: 180, emoji: '🛋️', desc: '柔软的双人休息沙发', type: 'furniture', slot: 'sofa', scene: 'living' },
  { id: 'furn_living_table', name: '客厅茶几', price: 95, emoji: '🪵', desc: '摆放茶点的小茶几', type: 'furniture', slot: 'table', scene: 'living' },
  { id: 'furn_bedroom_lamp', name: '卧室暖光床头灯', price: 85, emoji: '🛋️', desc: '睡前陪伴的柔和灯光', type: 'furniture', slot: 'lamp', scene: 'bedroom' },
  { id: 'furn_bath_tub', name: '泡泡浴缸', price: 200, emoji: '🛁', desc: '装满泡泡的宠物浴缸', type: 'furniture', slot: 'tub', scene: 'bathroom' },
  { id: 'furn_bath_mat', name: '浴室防滑垫', price: 65, emoji: '🧼', desc: '柔软吸水的防滑脚垫', type: 'furniture', slot: 'mat', scene: 'bathroom' },
  { id: 'furn_outdoor_tent', name: '星空露营帐篷', price: 190, emoji: '⛺', desc: '周末户外露营小帐篷', type: 'furniture', slot: 'tent', scene: 'outdoor' },
  { id: 'furn_outdoor_tree', name: '花园大树', price: 130, emoji: '🌳', desc: '为花园添一片清凉树荫', type: 'furniture', slot: 'tree', scene: 'outdoor' }
]

module.exports = { ADD_REASONS, DEDUCT_REASONS, BLIND_BOX_TASKS, MALL_ITEMS, BONUS_RATE, SIGN_BASE, BLIND_BOX_REWARD, PET_SHOP }
