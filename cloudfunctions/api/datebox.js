// 约会盲盒：双方授权 → 标签选择 → 确认意愿 → 抽奖 → 双方接受
// 状态保存在 dateboxs 集合（每房间一条）。授权保留 2 小时，超时未完成自动重置。
const { db, _, getUserByOpenid, getRoomUsers } = require('./helpers')
const { CATEGORIES, TAGS, PROJECTS } = require('./datebox-data')

const AUTH_TTL = 2 * 3600 * 1000 // 授权保留 2 小时
const MAX_REDRAW = 2 // 一次抽奖最多「换一个」两次
const HIGH_COST = '高花费'
const MAX_TAGS = 2

function nowMs() { return Date.now() }

function emptyState() {
  return {
    phase: 'auth', // auth | select | draw | done
    authorizedAt: {},
    tags: {},
    confirmedAt: {},
    result: null,
    mode: null, // match | fallback | blind
    shown: [],
    redrawCount: 0,
    acceptedAt: {},
    winner: null,
    sessionStartedAt: null,
  }
}

async function getDoc(roomId) {
  const res = await db.collection('dateboxs').where({ roomId }).limit(1).get()
  return res.data[0] || null
}

async function getOrCreateDoc(roomId) {
  let doc = await getDoc(roomId)
  if (doc) return doc
  const addRes = await db.collection('dateboxs').add({ data: { roomId, ...emptyState(), createdAt: db.serverDate() } })
  return { _id: addRes._id, roomId, ...emptyState() }
}

function normalize(doc) {
  return {
    ...doc,
    authorizedAt: doc.authorizedAt || {},
    tags: doc.tags || {},
    confirmedAt: doc.confirmedAt || {},
    acceptedAt: doc.acceptedAt || {},
    shown: doc.shown || [],
    redrawCount: doc.redrawCount || 0,
  }
}

function isExpired(doc) {
  if (!doc.sessionStartedAt || doc.phase === 'done') return false
  const start = typeof doc.sessionStartedAt === 'number' ? doc.sessionStartedAt : new Date(doc.sessionStartedAt).getTime()
  return (nowMs() - start) > AUTH_TTL
}

async function resetIfExpired(doc) {
  if (!isExpired(doc)) return doc
  const fresh = emptyState()
  await db.collection('dateboxs').doc(doc._id).update({
    data: {
      phase: 'auth',
      authorizedAt: _.set({}),
      tags: _.set({}),
      confirmedAt: _.set({}),
      result: _.set(null),
      mode: _.set(null),
      shown: _.set([]),
      redrawCount: _.set(0),
      acceptedAt: _.set({}),
      winner: _.set(null),
      sessionStartedAt: _.set(null),
      updatedAt: db.serverDate(),
    },
  })
  return { ...normalize(doc), ...fresh }
}

// ============ 抽奖核心：按标签匹配 ============
function drawProject(myTags, partnerTags, shownNames) {
  const bothHigh = myTags.includes(HIGH_COST) && partnerTags.includes(HIGH_COST)
  const eligible = p => !(p.tags.includes(HIGH_COST) && !bothHigh) && !shownNames.includes(p.name)
  const rand = arr => arr[Math.floor(Math.random() * arr.length)]

  // 第一步：双方标签交集
  const inter = myTags.filter(t => partnerTags.includes(t))
  if (inter.length) {
    const pool = PROJECTS.filter(p => eligible(p) && p.tags.some(t => inter.includes(t)))
    if (pool.length) return { project: rand(pool), mode: 'match' }
  }

  // 第二步：组合匹配（A 第一个标签 × B 第一个标签优先，再尝试其它组合）
  for (const a of myTags) {
    for (const b of partnerTags) {
      const pool = PROJECTS.filter(p => eligible(p) && p.tags.includes(a) && p.tags.includes(b))
      if (pool.length) return { project: rand(pool), mode: 'match' }
    }
  }

  // 第三步：双方标签合集随机
  const union = [...new Set([...myTags, ...partnerTags])]
  const pool3 = PROJECTS.filter(p => eligible(p) && p.tags.some(t => union.includes(t)))
  if (pool3.length) return { project: rand(pool3), mode: 'fallback' }

  // 第四步：全量随机
  const pool4 = PROJECTS.filter(p => eligible(p))
  if (pool4.length) return { project: rand(pool4), mode: 'blind' }
  const pool5 = PROJECTS.filter(p => !(p.tags.includes(HIGH_COST) && !bothHigh))
  return { project: rand(pool5), mode: 'blind' }
}

// ============ 组装前端视图 ============
function buildView(doc, roomUsers, OPENID) {
  const partner = roomUsers.find(u => u.openid !== OPENID) || null
  const auth = doc.authorizedAt || {}
  const conf = doc.confirmedAt || {}
  const acc = doc.acceptedAt || {}
  return {
    phase: doc.phase,
    hasPartner: !!partner,
    myAuthorized: !!auth[OPENID],
    partnerAuthorized: partner ? !!auth[partner.openid] : false,
    myTags: (doc.tags[OPENID] || []),
    partnerTags: partner ? (doc.tags[partner.openid] || []) : [],
    myConfirmed: !!conf[OPENID],
    partnerConfirmed: partner ? !!conf[partner.openid] : false,
    myAccepted: !!acc[OPENID],
    partnerAccepted: partner ? !!acc[partner.openid] : false,
    result: doc.result || null,
    mode: doc.mode || null,
    winner: doc.winner || null,
    redrawCount: doc.redrawCount || 0,
    redrawLeft: Math.max(0, MAX_REDRAW - (doc.redrawCount || 0)),
    partner: partner ? { nickname: partner.nickname, avatar: partner.avatar } : null,
    categories: CATEGORIES,
    tags: TAGS,
  }
}

// ============ 查询当前状态 ============
async function dateboxGet(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  const roomUsers = await getRoomUsers(me.roomId)
  return { code: 0, data: buildView(doc, roomUsers, OPENID) }
}

// ============ 授权（「我想抽奖」/「确认开启」）============
async function dateboxAuth(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  const roomUsers = await getRoomUsers(me.roomId)
  if (roomUsers.length < 2) throw new Error('需要两个人才能玩约会盲盒哦~')

  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  if (doc.phase === 'done') throw new Error('上一局已完成，点「再来一局」重新开始')

  const authorizedAt = { ...doc.authorizedAt, [OPENID]: nowMs() }
  const sessionStartedAt = doc.sessionStartedAt || nowMs()
  const both = roomUsers.every(u => authorizedAt[u.openid])
  const phase = both ? 'select' : 'auth'

  await db.collection('dateboxs').doc(doc._id).update({
    data: { authorizedAt, sessionStartedAt, phase, updatedAt: db.serverDate() },
  })
  return { code: 0, data: buildView({ ...doc, authorizedAt, sessionStartedAt, phase }, roomUsers, OPENID) }
}

// ============ 选择标签（1-2 个，可随时改）============
async function dateboxSelect(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  if (doc.phase !== 'select') throw new Error('当前阶段不能选择标签')
  if (!doc.authorizedAt[OPENID]) throw new Error('请先授权开启')

  const tags = Array.isArray(event.tags) ? event.tags.map(String) : []
  if (!tags.length || tags.length > MAX_TAGS) throw new Error('请选择 1-2 个标签')
  if (!tags.every(t => TAGS.some(x => x.name === t))) throw new Error('标签不合法')

  const allTags = { ...doc.tags, [OPENID]: tags }
  // 改了标签后，清掉我之前的「确认」，需要重新确认
  const confirmedAt = { ...doc.confirmedAt }
  delete confirmedAt[OPENID]
  await db.collection('dateboxs').doc(doc._id).update({ data: { tags: allTags, confirmedAt, updatedAt: db.serverDate() } })

  const roomUsers = await getRoomUsers(me.roomId)
  return { code: 0, data: buildView({ ...doc, tags: allTags, confirmedAt }, roomUsers, OPENID) }
}

// ============ 确认意愿 ============
async function dateboxConfirm(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  if (doc.phase !== 'select') throw new Error('当前阶段不能确认意愿')
  if (!doc.authorizedAt[OPENID]) throw new Error('请先授权开启')
  const myTags = doc.tags[OPENID]
  if (!myTags || !myTags.length) throw new Error('请先选择标签')

  const roomUsers = await getRoomUsers(me.roomId)
  const confirmedAt = { ...doc.confirmedAt, [OPENID]: nowMs() }
  const bothConfirmed = roomUsers.length === 2 && roomUsers.every(u => confirmedAt[u.openid])

  if (bothConfirmed) {
    const partner = roomUsers.find(u => u.openid !== OPENID)
    const pTags = partner ? (doc.tags[partner.openid] || []) : []
    const drawn = drawProject(myTags, pTags, [])
    const data = {
      confirmedAt,
      phase: 'draw',
      result: _.set(drawn.project),
      mode: drawn.mode,
      shown: [drawn.project.name],
      redrawCount: 0,
      acceptedAt: {},
      winner: _.set(null),
      updatedAt: db.serverDate(),
    }
    await db.collection('dateboxs').doc(doc._id).update({ data })
    return { code: 0, data: buildView({ ...doc, confirmedAt, phase: 'draw', result: drawn.project, mode: drawn.mode, shown: [drawn.project.name], redrawCount: 0, acceptedAt: {}, winner: null }, roomUsers, OPENID) }
  }

  await db.collection('dateboxs').doc(doc._id).update({ data: { confirmedAt, updatedAt: db.serverDate() } })
  return { code: 0, data: buildView({ ...doc, confirmedAt }, roomUsers, OPENID) }
}

// ============ 换一个 / 拒绝（重新抽取）============
async function dateboxDraw(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  if (doc.phase !== 'draw') throw new Error('当前阶段不能重新抽取')
  if (doc.redrawCount >= MAX_REDRAW) throw new Error('本次最多只能再换两次哦~')

  const roomUsers = await getRoomUsers(me.roomId)
  const myTags = doc.tags[OPENID] || []
  const partner = roomUsers.find(u => u.openid !== OPENID)
  const pTags = partner ? (doc.tags[partner.openid] || []) : []

  const drawn = drawProject(myTags, pTags, doc.shown)
  const data = {
    result: _.set(drawn.project),
    mode: drawn.mode,
    shown: [...doc.shown, drawn.project.name],
    redrawCount: doc.redrawCount + 1,
    acceptedAt: {}, // 重新抽取后双方需重新确认
    updatedAt: db.serverDate(),
  }
  await db.collection('dateboxs').doc(doc._id).update({ data })
  return { code: 0, data: buildView({ ...doc, result: drawn.project, mode: drawn.mode, shown: [...doc.shown, drawn.project.name], redrawCount: doc.redrawCount + 1, acceptedAt: {} }, roomUsers, OPENID) }
}

// ============ 就这个了 / 我接受 ============
async function dateboxAccept(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  let doc = normalize(await getOrCreateDoc(me.roomId))
  doc = await resetIfExpired(doc)
  if (doc.phase !== 'draw') throw new Error('当前阶段不能确认')
  if (!doc.result) throw new Error('还没有抽奖结果')

  const roomUsers = await getRoomUsers(me.roomId)
  const acceptedAt = { ...doc.acceptedAt, [OPENID]: nowMs() }
  const both = roomUsers.length === 2 && roomUsers.every(u => acceptedAt[u.openid])
  const data = { acceptedAt, phase: both ? 'done' : 'draw', winner: both ? _.set(doc.result) : _.set(null), updatedAt: db.serverDate() }
  await db.collection('dateboxs').doc(doc._id).update({ data })
  return { code: 0, data: buildView({ ...doc, acceptedAt, phase: both ? 'done' : 'draw', winner: both ? doc.result : null }, roomUsers, OPENID) }
}

// ============ 再来一局（重置）============
async function dateboxReset(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  const doc = await getOrCreateDoc(me.roomId)
  const fresh = emptyState()
  await db.collection('dateboxs').doc(doc._id).update({
    data: {
      phase: 'auth',
      authorizedAt: _.set({}),
      tags: _.set({}),
      confirmedAt: _.set({}),
      result: _.set(null),
      mode: _.set(null),
      shown: _.set([]),
      redrawCount: _.set(0),
      acceptedAt: _.set({}),
      winner: _.set(null),
      sessionStartedAt: _.set(null),
      updatedAt: db.serverDate(),
    },
  })
  const roomUsers = await getRoomUsers(me.roomId)
  return { code: 0, data: buildView({ ...doc, ...fresh }, roomUsers, OPENID) }
}

module.exports = { dateboxGet, dateboxAuth, dateboxSelect, dateboxConfirm, dateboxDraw, dateboxAccept, dateboxReset }
