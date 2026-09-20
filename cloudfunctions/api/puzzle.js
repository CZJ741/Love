// 反向合影（拼图挑战）：累计式玩法
// 每天给出一个奇怪拍摄主题，双方各拍一张，拼合成左右对比的「一组拼图」。
// 规则：
//   1. 每一组拼图 = 同一天双方都完成拍摄（各一张视角）。
//   2. 系统累计记录历史所有完成的拼图组，不关注是否连续、不关注缺勤。
//   3. 累计满 9 组后，可生成一张完整的「九宫格大拼图」（3x3 排列 9 组）。
//   4. 数据永久保留，不再按周清理。
const { cloud, db, _, getUserByOpenid, getRoomUsers, cnDateStr } = require('./helpers')
const { earn } = require('./economy')

// 趣味/奇怪视角的拍摄主题池（80+ 个丰富日常创意，每日随机轮换）
const THEMES = [
  '拍你左脚边的地板',
  '拍你窗外最绿的东西',
  '拍你此刻的午饭/晚餐残骸',
  '拍距离你最近的一个插座',
  '拍一张微距的衣服布料纹理',
  '拍你桌上最不起眼的一支笔',
  '拍喝了一半的水杯或饮料',
  '拍你头顶正上方的天花板或天空',
  '拍今天身边的第一个影子',
  '拍周围最红的一件小物品',
  '拍一片落叶或一片绿植',
  '拍你写了字的随手草稿纸',
  '拍一双你今天穿的鞋子',
  '拍一处阳光照进来的光斑',
  '拍你正在用的键盘或屏幕一角',
  '拍你身边的门把手或开关',
  '拍一个圆形的东西假装太阳',
  '拍你手掌比作的半个爱心',
  '拍窗玻璃上的倒影或雨水',
  '拍一个你最常用的充电头或数据线',
  '拍今天吃到的最好吃的一口',
  '拍身边一件蓝色的东西',
  '拍一个随手揉成团的纸团',
  '拍你钥匙扣上的挂件',
  '拍你书架或桌上最厚的一本书',
  '拍一朵路边经过时看见的花',
  '拍你洗手台上的牙刷或杯子',
  '拍你背包或者口袋里的一件小物',
  '拍你现在戴着的手表/首饰/发圈',
  '拍周围反射出你轮廓的一面镜子',
  '拍窗外掠过的一只飞鸟或电线杆',
  '拍一个撕开的零食包装袋',
  '拍你喝热饮升起的热气',
  '拍你坐着的椅背或沙发纹理',
  '拍周围一件黄色的物品',
  '拍一处墙角的微小缝隙',
  '拍你今天迈出的第一步地面',
  '拍你的水杯在桌上留下的水渍圈',
  '拍你正在看的一页书或便签',
  '拍你掌心的生命线',
  '拍一个你觉得形状很奇怪的石头或云朵',
  '拍路边或家里的一个黄色指示标',
  '拍你吃完水果剩下的果皮或核',
  '拍一处被夕阳染黄的墙壁',
  '拍你最喜欢的一只杯子把手',
  '拍今晚你看到的第一颗星星或路灯',
  '拍你影子拉得最长的一瞬间',
  '拍一处几何线条分明的建筑或窗框',
  '拍你桌上的耳机线打成的结',
  '拍你现在最想给对方看的一角',
  '拍你冰箱冷藏室最上面的那一层',
  '拍今天踩过的第一块斑马线或地砖',
  '拍你最爱穿的一件外套袖口',
  '拍你手机锁屏那一瞬间反射的光',
  '拍随手抓起的一把硬币或小零碎',
  '拍距离你最近的一张纸巾或湿巾',
  '拍窗边的一盆多肉或盆栽',
  '拍一处剥落或斑驳的墙皮小细节',
  '拍你现在握着的鼠标或握笔的手势',
  '拍你包包里拉链头上的小标志',
  '拍你喝完饮料后杯底剩下的冰块',
  '拍你今天吃到的第一口主食',
  '拍一扇半掩着的房门或推拉窗',
  '拍你脚下的一双袜子或拖鞋图案',
  '拍周围带条纹图案的一件物品',
  '拍一个写着价格标签的小商品',
  '拍你枕头或者被角凹陷的褶皱',
  '拍一盏亮着的台灯或吊灯微光',
  '拍雨伞折叠起来后的伞扣细节',
  '拍今天走过的楼梯台阶转角',
  '拍一张被折起角的书页',
  '拍你手腕内侧的浅浅青色静脉',
  '拍你书桌或茶几底下的一小片空间',
  '拍一把剪刀或一把小尺子',
  '拍你正在嚼的口香糖或含着的润喉糖包装',
  '拍窗台缝隙里积存的一小粒微光',
  '拍今天收到的快递盒或包装箱胶带',
  '拍一只倒扣在桌上的手机壳背影',
  '拍洗手液搓出来的绵密白色泡沫',
  '拍今天抬头第一眼看见的那朵云',
]

// 奖励积分：双方都完成后各得 15 分
const REWARD_POINTS = 15

// 九宫格所需累计完成组数
const GRID_SIZE = 9

// 根据日期与房间ID计算哈希，确保同房间情侣当日永远看到完全相同的主题
function getThemeByDateAndRoom(dateStr, roomId) {
  let hash = 0
  const seed = `${dateStr}_${roomId}_puzzle`
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % THEMES.length
  return THEMES[index]
}

// 统计该房间历史累计完成的拼图组数，以及最近完成组的日期集合
// 不关注连续性与缺勤，只做总量累计
async function countCompletedGroups(roomId) {
  const countRes = await db.collection('reverse_photos')
    .where({ roomId, status: 'completed' })
    .count()

  const total = countRes.total || 0
  return { total }
}

// 1. 获取今日挑战详情
async function puzzleGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  if (!me.roomId) {
    return {
      code: 0,
      data: {
        date: cnDateStr(),
        theme: '拍你身边最治愈的一角',
        status: 'pending',
        myUploaded: false,
        partnerUploaded: false,
        myPhotoUrl: '',
        partnerPhotoUrl: '',
        partnerNickname: 'TA',
        myNickname: me.nickname || '我',
        completedGroups: 0,
        gridSize: GRID_SIZE,
        reward: REWARD_POINTS,
        canGeneratePoster: false,
      },
    }
  }

  const date = cnDateStr()

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID) || null

  let recordRes = await db.collection('reverse_photos')
    .where({ roomId: me.roomId, date })
    .limit(1)
    .get()

  let record = recordRes.data[0]
  if (!record) {
    const theme = getThemeByDateAndRoom(date, me.roomId)
    const addRes = await db.collection('reverse_photos').add({
      data: {
        roomId: me.roomId,
        date,
        theme,
        photos: {},
        status: 'pending',
        rewarded: false,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    })
    record = {
      _id: addRes._id,
      roomId: me.roomId,
      date,
      theme,
      photos: {},
      status: 'pending',
      rewarded: false,
    }
  }

  const myPhoto = record.photos && record.photos[OPENID]
  const partnerOpenid = partner ? partner.openid : null
  const partnerPhoto = partnerOpenid && record.photos ? record.photos[partnerOpenid] : null

  const myUploaded = !!(myPhoto && myPhoto.fileId)
  const partnerUploaded = !!(partnerPhoto && partnerPhoto.fileId)
  const isCompleted = record.status === 'completed' || (myUploaded && partnerUploaded)

  // 悬念设计：若我尚未拍照，绝不下发对方的真实图片 URL，避免控制台窃看原图
  const fileIdsToResolve = []
  if (myUploaded) fileIdsToResolve.push(myPhoto.fileId)
  if (isCompleted && partnerUploaded) fileIdsToResolve.push(partnerPhoto.fileId)

  let tempUrlMap = {}
  if (fileIdsToResolve.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: fileIdsToResolve })
      if (urlRes && urlRes.fileList) {
        urlRes.fileList.forEach(item => {
          tempUrlMap[item.fileID] = item.tempFileURL
        })
      }
    } catch (e) {
      console.error('[puzzle] getTempFileURL error', e)
    }
  }

  const { total } = await countCompletedGroups(me.roomId)

  return {
    code: 0,
    data: {
      date: record.date,
      theme: record.theme,
      status: isCompleted ? 'completed' : 'pending',
      myUploaded,
      partnerUploaded,
      myPhotoUrl: myUploaded ? (tempUrlMap[myPhoto.fileId] || '') : '',
      // 双方完成才下发对方清晰图，否则下发空
      partnerPhotoUrl: (isCompleted && partnerUploaded) ? (tempUrlMap[partnerPhoto.fileId] || '') : '',
      partnerNickname: partner ? partner.nickname : 'TA',
      myNickname: me.nickname,
      completedGroups: total,
      gridSize: GRID_SIZE,
      reward: REWARD_POINTS,
      // 累计完成满 9 组即可解锁生成九宫格大拼图
      canGeneratePoster: total >= GRID_SIZE,
    },
  }
}

// 2. 上传/提交我的拍摄碎片
async function puzzleUpload(event, ctx) {
  const { OPENID } = ctx
  const { fileId } = event
  if (!fileId) throw new Error('缺少图片 fileId')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('请先加入小窝')

  const date = cnDateStr()

  let recordRes = await db.collection('reverse_photos')
    .where({ roomId: me.roomId, date })
    .limit(1)
    .get()

  let record = recordRes.data[0]
  if (!record) {
    // 若尚未创建当天挑战记录，则自动初始化
    const theme = getThemeByDateAndRoom(date, me.roomId)
    const addRes = await db.collection('reverse_photos').add({
      data: {
        roomId: me.roomId,
        date,
        theme,
        photos: {},
        status: 'pending',
        rewarded: false,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    })
    record = {
      _id: addRes._id,
      roomId: me.roomId,
      date,
      theme,
      photos: {},
      status: 'pending',
      rewarded: false,
    }
  }

  const photos = record.photos || {}
  photos[OPENID] = {
    fileId,
    uploadedAt: Date.now(),
  }

  const roomUsers = await getRoomUsers(me.roomId)
  const partner = roomUsers.find(u => u.openid !== OPENID)
  const partnerOpenid = partner ? partner.openid : null

  const partnerUploaded = partnerOpenid && photos[partnerOpenid] && photos[partnerOpenid].fileId
  const bothUploaded = Boolean(partnerUploaded)

  const updateData = {
    photos,
    updatedAt: db.serverDate(),
  }

  let newlyCompleted = false
  if (bothUploaded && record.status !== 'completed') {
    updateData.status = 'completed'
    newlyCompleted = true
  }

  await db.collection('reverse_photos').doc(record._id).update({
    data: updateData,
  })

  // 如果双人完成且未发放过积分，给予双方互动积分奖励
  if (newlyCompleted && !record.rewarded) {
    await db.collection('reverse_photos').doc(record._id).update({
      data: { rewarded: true },
    })

    for (const u of roomUsers) {
      await earn({
        userDoc: u,
        earned: REWARD_POINTS,
        type: 'surprise',
        reason: '完成今日反向合影拼图挑战',
        fromUser: '📷 反向合影',
        fromOpenid: 'system',
      })
    }
  }

  const { total } = await countCompletedGroups(me.roomId)

  return {
    code: 0,
    msg: bothUploaded ? `拼图合拍成功！双方各获得 ${REWARD_POINTS} 积分` : '已上传你的视角，等待TA拍摄拼合',
    data: {
      completed: bothUploaded,
      completedGroups: total,
      gridSize: GRID_SIZE,
      newlyCompleted,
    },
  }
}

// 3. 查询累计进度与简要打卡状态（供主页卡片轻量展示）
async function puzzleGetStreak(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const date = cnDateStr()

  if (!me.roomId) {
    return {
      code: 0,
      data: {
        date,
        theme: '拍你身边最治愈的一角',
        status: 'pending',
        myUploaded: false,
        partnerUploaded: false,
        completedGroups: 0,
        gridSize: GRID_SIZE,
      },
    }
  }

  let recordRes = await db.collection('reverse_photos')
    .where({ roomId: me.roomId, date })
    .limit(1)
    .get()

  let theme = ''
  let status = 'pending'
  let myUploaded = false
  let partnerUploaded = false

  if (recordRes.data.length > 0) {
    const record = recordRes.data[0]
    theme = record.theme
    status = record.status
    const photos = record.photos || {}
    myUploaded = Boolean(photos[OPENID] && photos[OPENID].fileId)
    const partnerOpenid = Object.keys(photos).find(id => id !== OPENID)
    partnerUploaded = Boolean(partnerOpenid && photos[partnerOpenid] && photos[partnerOpenid].fileId)
  } else {
    theme = getThemeByDateAndRoom(date, me.roomId)
  }

  const { total } = await countCompletedGroups(me.roomId)

  return {
    code: 0,
    data: {
      date,
      theme,
      status,
      myUploaded,
      partnerUploaded,
      completedGroups: total,
      gridSize: GRID_SIZE,
    },
  }
}

// 4. 获取最近 9 组完成的拼图数据（每组两张，共 18 张），用于生成九宫格大拼图
async function puzzleGetPosterData(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('请先加入小窝')

  // 拉取全部已完成记录，按日期倒序取最近 9 组
  const recordsRes = await db.collection('reverse_photos')
    .where({
      roomId: me.roomId,
      status: 'completed',
    })
    .orderBy('date', 'desc')
    .limit(GRID_SIZE)
    .get()

  if (recordsRes.data.length < GRID_SIZE) {
    throw new Error(`已累计 ${recordsRes.data.length} 组拼图，需集满 ${GRID_SIZE} 组才能生成九宫格大拼图哦`)
  }

  // 按日期升序呈现，让九宫格的时间线自然推进
  const records = recordsRes.data.slice().reverse()

  const allFileIds = []
  const groupsData = []

  for (const item of records) {
    const pKeys = Object.keys(item.photos || {})
    const p1 = pKeys[0] ? item.photos[pKeys[0]].fileId : null
    const p2 = pKeys[1] ? item.photos[pKeys[1]].fileId : null
    if (p1) allFileIds.push(p1)
    if (p2) allFileIds.push(p2)

    groupsData.push({
      date: item.date,
      theme: item.theme,
      photo1FileId: p1,
      photo2FileId: p2,
    })
  }

  // 换取临时访问 URL
  const urlRes = await cloud.getTempFileURL({ fileList: allFileIds })
  const urlMap = {}
  if (urlRes && urlRes.fileList) {
    urlRes.fileList.forEach(f => {
      urlMap[f.fileID] = f.tempFileURL
    })
  }

  const roomUsers = await getRoomUsers(me.roomId)
  const user1 = roomUsers[0] ? roomUsers[0].nickname : '我'
  const user2 = roomUsers[1] ? roomUsers[1].nickname : 'TA'

  // 每一组（一格）包含双方两张切片
  const groups = []
  groupsData.forEach((group, idx) => {
    const cells = []
    if (group.photo1FileId && urlMap[group.photo1FileId]) {
      cells.push({ url: urlMap[group.photo1FileId], side: 'left' })
    }
    if (group.photo2FileId && urlMap[group.photo2FileId]) {
      cells.push({ url: urlMap[group.photo2FileId], side: 'right' })
    }
    groups.push({
      date: group.date,
      theme: group.theme,
      index: idx + 1,
      cells,
    })
  })

  return {
    code: 0,
    data: {
      user1,
      user2,
      startDate: records[0].date,
      endDate: records[records.length - 1].date,
      gridSize: GRID_SIZE,
      groups,
    },
  }
}

module.exports = {
  puzzleGet,
  puzzleUpload,
  puzzleGetStreak,
  puzzleGetPosterData,
}
