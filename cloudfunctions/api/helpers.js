// 云函数通用工具：初始化环境、数据库句柄、常用查询与日期帮助函数
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 业务所需的全部集合（首次调用云函数时自动创建，无需在控制台手动建集合）
const COLLECTIONS = ['users', 'transactions', 'wishes', 'dailies', 'moments', 'rooms', 'dateboxs', 'reverse_photos', 'board_games', 'locations', 'pets']

let _collectionsReady = false

// 自动建集合：幂等。集合已存在时 createCollection 会抛错，直接忽略即可。
async function ensureCollections() {
  if (_collectionsReady) return
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
    } catch (e) {
      // 已存在 / 权限等原因：忽略，后续真实查询会暴露真正的问题
    }
  }
  _collectionsReady = true
}

// 按 openid 查询用户档案（openid 由微信自动注入，一人一个档案）
async function getUserByOpenid(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return res.data[0] || null
}

// 获取同一房间的所有用户（小窝限定两人）
async function getRoomUsers(roomId) {
  const res = await db.collection('users').where({ roomId }).limit(10).get()
  return res.data
}

// 按 _id 查询房间
async function getRoomById(id) {
  const res = await db.collection('rooms').doc(id).get()
  return res.data || null
}

// 今天 00:00（UTC+8）对应的服务器时间，用于「是否已签到」等按天判断
function todayStartServerDate() {
  const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
  const ymd = nowCn.toISOString().slice(0, 10)
  return new Date(ymd + 'T00:00:00+08:00')
}

// 中国时区 (UTC+8) 的 YYYY-MM-DD，可偏移若干天
function cnDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// 整数四舍五入（积分都是整数，避免小数带来的展示问题）
function round(n) {
  return Math.round(n)
}

module.exports = { cloud, db, _, ensureCollections, getUserByOpenid, getRoomUsers, getRoomById, todayStartServerDate, cnDateStr, round }
