// 全局常量：加分/扣分理由、盲盒任务、商城商品等
// 注意：商城商品与盲盒任务需与云函数 cloudfunctions/api 中的保持一致

// 加分事由
const ADD_REASONS = [
  '今天特别乖', '主动做家务', '给我买好吃的', '哄我开心', '陪我逛街',
  '说早安晚安', '帮我按摩', '陪我散步', '送我小礼物', '给我买奶茶',
  '做顿饭给我吃', '超贴心',
]

// 扣分事由
const DEDUCT_REASONS = [
  '惹我生气了', '忘记说晚安', '打游戏不理我', '约会迟到', '没回消息',
  '不陪我', '说好的事忘了', '态度敷衍', '又熬夜', '说话不算话',
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

module.exports = { ADD_REASONS, DEDUCT_REASONS, BLIND_BOX_TASKS, MALL_ITEMS, BONUS_RATE, SIGN_BASE, BLIND_BOX_REWARD }
