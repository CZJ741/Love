// 全局实时数据层：通过 watch 监听 users / transactions / wishes，供各页面共享与实时刷新
// 两个人面对面操作时，双方手机页面会自动同步，无需下拉刷新。
const { dateStr, addDays } = require('../utils/format')

// 数据库实例延迟创建：必须在 wx.cloud.init() 之后再调用 wx.cloud.database()
let _db = null
function getDB() {
  if (!_db) _db = wx.cloud.database()
  return _db
}

let roomId = ''
let roomDoc = null // 房间文档 { _id, name, hasPassword, ... }
let myOpenid = ''
let users = []
let transactions = []
let wishes = []
let moments = []
let watchers = []
let listeners = {}
let lastWishStatus = {} // 用于检测「心愿刚完成」，触发撒花特效

function emit(event, payload) {
  ;(listeners[event] || []).forEach(cb => {
    try { cb(payload) } catch (e) { console.error(e) }
  })
}

function on(event, cb) {
  ;(listeners[event] = listeners[event] || []).push(cb)
  return cb
}

function off(event, cb) {
  const arr = listeners[event]
  if (!arr) return
  const i = arr.indexOf(cb)
  if (i >= 0) arr.splice(i, 1)
}

function setMyOpenid(v) { myOpenid = v }

function getMe() { return users.find(u => u.openid === myOpenid) || null }
function getPartner() { return users.find(u => u.openid !== myOpenid) || null }
function getUsers() { return users }
function getTransactions() { return transactions }
function getWishes() { return wishes }
function getMoments() { return moments }

// 用云函数返回的房间成员「播种」本地用户表。
// 关键：login 云函数是服务端读库，不受前端数据库读权限限制；
// 即使前端 watch/get users 因权限读不到，也能先看到两人档案，加分也能拿到对方 openid。
function seedRoom(roomUsers) {
  if (!Array.isArray(roomUsers) || !roomUsers.length) return
  mergeUsers(roomUsers)
}

// 合并用户表（以 openid 去重）：保留已存在但前端读权限看不到的成员，
// 避免权限过滤后的「只读到自己」覆盖掉播种进来的对方数据。
function mergeUsers(list) {
  const map = {}
  users.forEach(u => { if (u && u.openid) map[u.openid] = u })
  ;(list || []).forEach(u => { if (u && u.openid) map[u.openid] = u })
  users = Object.keys(map).map(k => map[k])
  saveProfile()
  emit('users', users)
}

// 把最新的“我”同步到本地缓存（密码不落盘）
function saveProfile() {
  const me = getMe()
  if (me) {
    const save = Object.assign({}, me)
    delete save.password
    wx.setStorageSync('myProfile', save)
  }
  return me
}

// 初始化：启动监听 + 拉取一次全量数据
function init(rid, openid) {
  roomId = rid
  myOpenid = openid || myOpenid
  startWatches()
  return fetchOnce()
}

// 逐个集合拉取：某个集合读失败（如权限/集合不存在）不影响其它集合的数据
function fetchOnce() {
  if (!roomId) return Promise.resolve()

  const fetchUsers = () => getDB().collection('users').where({ roomId }).get()
    .then(res => {
      mergeUsers(res.data)
    })
  const fetchWishes = () => getDB().collection('wishes').where({ roomId }).get()
    .then(res => {
      wishes = res.data
      emit('wishes', wishes)
    })
  const fetchMoments = () => require('./api').call('listMoments')
    .then(data => {
      const list = (data && data.length ? data : [])
      moments = list.map(m => ({ ...m, timeDisplay: fmtMomentTime(m.createdAt) }))
      sortMomentsDesc(moments)
      emit('moments', moments)
    })

  // 非「集合不存在」的错误直接吞掉（保住其它集合已拉到的数据）；
  // 集合不存在则抛出，由下方 attempt 触发云函数自动建集合并重试
  const softFetch = p => p.catch(e => {
    if (isCollectionMissing(e)) throw e
    console.error('realtime.fetch', e && e.errMsg)
  })

  const attempt = () => Promise.all([softFetch(fetchUsers()), softFetch(fetchTx()), softFetch(fetchWishes()), softFetch(fetchMoments())])
    .catch(e => {
      // 集合可能还没创建（如首次启动页面直接读取）：走一次云函数 login（会自动建集合）再重试
      return require('./api').call('login', { roomId })
        .then(attempt)
        .catch(e2 => console.error('realtime.fetchOnce(retry)', e2 && e2.errMsg))
    })

  return attempt()
}

// 通过云函数拉取流水（绕过前端读权限限制）
function fetchTx() {
  if (!roomId) return Promise.resolve()
  return require('./api').call('listTransactions')
    .then(data => {
      transactions = Array.isArray(data) ? data : []
      emit('transactions', transactions)
    })
}

// 判断是否为「集合不存在」类错误
function isCollectionMissing(e) {
  const msg = (e && (e.errMsg || e.message || '')) || ''
  return /collection (is )?not exist|COLLECTION_NOT_EXIST|not exists/i.test(msg)
}

function startWatches() {
  stopWatches()
  if (!roomId) return

  // 1. 监听 users：双方信息与余额变更实时推送
  watchers.push(getDB().collection('users').where({ roomId }).watch({
    onChange: snap => {
      mergeUsers(snap.docs) // 合并成员数据并触发 users 事件更新
    },
    onError: e => console.error('[realtime] users watch error:', e),
  }))

  // 2. 监听 transactions：积分流水实时推送
  watchers.push(getDB().collection('transactions').where({ roomId }).watch({
    onChange: snap => {
      const list = snap.docs ? snap.docs.slice() : []
      list.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return tb - ta
      })
      transactions = list
      emit('transactions', transactions)
    },
    onError: e => console.error('[realtime] transactions watch error:', e),
  }))

  // 3. 监听 wishes：心愿状态实时推送
  watchers.push(getDB().collection('wishes').where({ roomId }).watch({
    onChange: snap => {
      const newlyCompleted = []
      snap.docs.forEach(w => {
        if (w.status === 'completed' && lastWishStatus[w._id] && lastWishStatus[w._id] !== 'completed') {
          newlyCompleted.push(w)
        }
        lastWishStatus[w._id] = w.status
      })
      wishes = snap.docs
      emit('wishes', wishes)
      newlyCompleted.forEach(w => emit('wish-completed', w))
    },
    onError: e => console.error('[realtime] wishes watch error:', e),
  }))
}

let isPaused = false

function stopWatches() {
  watchers.forEach(w => { try { w.close() } catch (e) {} })
  watchers = []
}

// 切后台暂停长连接（休眠，停止持续计费与流量消耗）
function pauseWatches() {
  if (isPaused) return
  isPaused = true
  stopWatches()
  console.log('[realtime] watches paused (app onHide)')
}

// 切前台恢复长连接（自动重连并同步最新快照）
function resumeWatches() {
  if (!isPaused) return
  isPaused = false
  if (!roomId) return
  console.log('[realtime] watches resumed (app onShow)')
  startWatches()
  fetchOnce().catch(err => console.error('[realtime] resume fetchOnce err:', err))
  heartbeat(true)
}

// 格式化点滴时间展示
function fmtMomentTime(ts) {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前'
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return y === now.getFullYear() ? m + '月' + day + '日' : y + '年' + m + '月' + day + '日'
}

// 将 createdAt 转为可比较的数值，兼容 Date / 毫秒时间戳 / 秒级时间戳 / ISO 字符串
function toTs(v) {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.getTime()
  }
  // 云数据库可能返回 {$date: ...} 对象
  if (v && v.$date) return toTs(v.$date)
  return 0
}
function sortMomentsDesc(list) {
  list.sort((a, b) => toTs(b.createdAt) - toTs(a.createdAt))
}

// 外部可调用：手动拉取最新点滴数据（通过云函数，绕过前端读权限限制）
function fetchMoments() {
  if (!roomId) return Promise.resolve()
  return require('./api').call('listMoments')
    .then(data => {
      const list = (data && data.length ? data : [])
      moments = list.map(m => ({ ...m, timeDisplay: fmtMomentTime(m.createdAt) }))
      sortMomentsDesc(moments)
      emit('moments', moments)
      return moments
    })
    .catch(e => {
      const msg = (e && (e.message || '')) || ''
      if (msg.includes('请先创建档案') || msg.includes('请先创建或加入')) {
        return [] // 档案不存在，静默返回空
      }
      console.error('fetchMoments', e)
      return []
    })
}

// 在列表最前面插入一条动态（乐观更新），同时后台拉取最新数据做同步
function prependMoment(m) {
  if (!m || !m._id) return
  // 去重：如果已存在同一 _id 则不重复插入
  if (moments.some(x => x._id === m._id)) return
  const item = { ...m, timeDisplay: fmtMomentTime(m.createdAt) }
  moments = [item, ...moments]
  emit('moments', moments)
}

// ======== 在线状态 ========
let _lastHeartbeat = 0
let _currentNetworkType = 'wifi'

if (typeof wx !== 'undefined' && wx.getNetworkType) {
  wx.getNetworkType({
    success: (res) => {
      _currentNetworkType = (res && res.networkType) || 'wifi'
    }
  })
  if (wx.onNetworkStatusChange) {
    wx.onNetworkStatusChange((res) => {
      _currentNetworkType = (res && res.networkType) || 'none'
    })
  }
}

function heartbeat(force = false) {
  const now = Date.now()
  // 节流：普通状态下最多 30 秒发一次心跳，force 强制立即上报
  if (!force && (now - _lastHeartbeat < 30000)) return
  _lastHeartbeat = now
  const api = require('./api')
  api.call('heartbeat', { networkType: _currentNetworkType }).catch(e => console.error('heartbeat', e))
}

function getMyNetworkType() {
  return _currentNetworkType
}

// 判断对方是否在线（lastActiveAt 在 3 分钟内视为在线）
function isPartnerOnline() {
  const partner = getPartner()
  if (!partner || !partner.lastActiveAt) return false
  const ts = toTs(partner.lastActiveAt)
  if (!ts) return false
  return (Date.now() - ts) < 3 * 60 * 1000
}

// 格式化最后活跃时间
function lastSeenText() {
  const partner = getPartner()
  if (!partner || !partner.lastActiveAt) return ''
  const ts = toTs(partner.lastActiveAt)
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚在线'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前在线'
  const d = new Date(ts)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
}

// 冷暴力预警：最近一笔流水距今 >= 3 天（即连续 3 天没有互动）
function checkColdWarning() {
  if (!transactions.length) return true
  const latest = new Date(transactions[0].createdAt).getTime()
  return (Date.now() - latest) >= 3 * 24 * 3600 * 1000
}

module.exports = {
  init, on, off, fetchOnce, fetchTx, setMyOpenid, saveProfile, seedRoom,
  setRoomDoc(doc) { roomDoc = doc },
  getRoomDoc() { return roomDoc },
  getMe, getPartner, getUsers, getTransactions, getWishes, getMoments,
  checkColdWarning, fetchMoments, prependMoment,
  heartbeat, isPartnerOnline, lastSeenText, getMyNetworkType,
  pauseWatches, resumeWatches,
}
