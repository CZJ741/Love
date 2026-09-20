// 冷暴力预警：给另一半发送订阅消息提醒
// 前置条件：
//   - 云函数环境变量 COLD_TEMPLATE_ID 已配置为订阅消息模板 ID
//   - 用户在小程序内点击过「同意订阅」按钮（wx.requestSubscribeMessage）
const { cloud, getUserByOpenid, getRoomUsers, cnDateStr } = require('./helpers')

async function sendColdReminder(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) return { code: 0, msg: '请先创建档案', data: { sent: false } }

  const templateId = process.env.COLD_TEMPLATE_ID
  if (!templateId) return { code: 0, msg: '未配置订阅消息模板（云函数环境变量 COLD_TEMPLATE_ID）', data: { sent: false } }

  const partner = (await getRoomUsers(me.roomId)).find(u => u.openid !== OPENID)
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: (partner && partner.openid) || OPENID,
      templateId,
      page: 'pages/home/home',
      miniprogramState: process.env.MINIPROGRAM_STATE || 'developer',
      data: {
        thing1: { value: '你们已经3天没有发糖了哦~' },
        time2: { value: cnDateStr() },
      },
    })
    return { code: 0, msg: '已提醒TA，快去发糖吧~', data: { sent: true } }
  } catch (e) {
    console.error('subscribeMessage.send', e)
    return { code: 0, msg: '发送失败，请检查订阅消息模板配置', data: { sent: false } }
  }
}

module.exports = { sendColdReminder }
