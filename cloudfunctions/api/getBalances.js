// 余额快照：服务端直接读取两人余额，绕过前端数据库读权限限制
// 用于前端快速轮询，确保双方积分岛实时同步
const { getUserByOpenid, getRoomUsers } = require('./helpers')

async function getBalances(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const roomUsers = await getRoomUsers(me.roomId)
  const myBalance = (roomUsers.find(u => u.openid === OPENID) || {}).balance || 0
  const partnerBalance = (roomUsers.find(u => u.openid !== OPENID) || {}).balance || 0

  return { code: 0, data: { myBalance, partnerBalance } }
}

module.exports = getBalances
