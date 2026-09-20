// ============ 云开发配置 ============
// envId：在微信开发者工具左上角「云开发」控制台获取，如 cli-xxxx
// 留空则使用默认云环境（需确保开发者工具已选中一个云环境）
const envId = 'cloud1-d1g71vlysbe503941'

// 冷暴力预警订阅消息模板 ID（也可用云函数环境变量 COLD_TEMPLATE_ID，二者取其一）
const COLD_TEMPLATE_ID = ''

module.exports = { envId, COLD_TEMPLATE_ID }
