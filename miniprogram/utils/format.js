// 时间与展示格式化工具
function pad(n) { return n < 10 ? '0' + n : '' + n }

// 判断头像是否为「图片」类型（云存储 fileID 或 http 链接）；否则视为 emoji 文本
function isCloudFile(v) {
  return typeof v === 'string' && (v.indexOf('cloud://') === 0 || v.indexOf('http') === 0)
}

function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function timeStr(d) {
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function addDays(d, n) {
  const r = new Date(d.getTime())
  r.setDate(r.getDate() + n)
  return r
}

// 积分流水时间展示
function formatTxTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = dateStr(new Date())
  const ystr = dateStr(addDays(new Date(), -1))
  const s = dateStr(d)
  if (s === today) return '今天 ' + timeStr(d)
  if (s === ystr) return '昨天 ' + timeStr(d)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr(d)
}

// 流水类型元信息
function typeMeta(type) {
  const map = {
    reward: { text: '奖励', emoji: '💗' },
    sign: { text: '签到', emoji: '📅' },
    punish: { text: '惩罚', emoji: '⚡' },
    redeem: { text: '兑换', emoji: '🎁' },
    surprise: { text: '惊喜', emoji: '🎉' },
    decay: { text: '降温', emoji: '❄️' },
  }
  return map[type] || { text: type, emoji: '✨' }
}

// 按时间段问候
function greeting() {
  const h = new Date().getHours()
  if (h < 1) return { main: '凌晨了', sub: '早点休息，晚安哦' }    // 00:00 - 01:00
  if (h < 6) return { main: '夜深了', sub: '好梦正酣，明天见' }    // 01:00 - 06:00
  if (h < 9) return { main: '早上好', sub: '新的一天，元气满满' }   // 06:00 - 09:00
  if (h < 12) return { main: '上午好', sub: '阳光正好，事事顺心' }  // 09:00 - 12:00
  if (h < 14) return { main: '中午好', sub: '记得好好吃饭哦' }      // 12:00 - 14:00
  if (h < 18) return { main: '下午好', sub: '喝杯茶，放松一下' }    // 14:00 - 18:00
  return { main: '晚上好', sub: '辛苦了，好好歇歇吧' }              // 18:00 - 24:00
}

module.exports = { pad, dateStr, timeStr, addDays, formatTxTime, typeMeta, greeting, isCloudFile }
