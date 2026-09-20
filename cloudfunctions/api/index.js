// 统一云函数入口：通过 action 分发所有业务操作
// 所有 balance 的加减都在这里完成，小程序前端没有任何直接 update 数据库的能力，防止作弊。
const { cloud, ensureCollections } = require('./helpers')
const room = require('./room')
const points = require('./points')
const transactions = require('./transactions')
const blindbox = require('./blindbox')
const wish = require('./wish')
const cold = require('./cold')
const moments = require('./moments')
const datebox = require('./datebox')
const getBalances = require('./getBalances')
const puzzle = require('./puzzle')
const decay = require('./decay')
const game = require('./game')
const location = require('./location')
const pet = require('./pet')

const HANDLERS = {
  // 档案与房间
  login: room.login,
  joinViaInvite: room.joinViaInvite,
  updateProfile: room.updateProfile,
  heartbeat: room.heartbeat,
  getRelationshipInfo: room.getRelationshipInfo,
  setRelationshipInfo: room.setRelationshipInfo,
  // 积分核心
  addPoints: points.addPoints,
  quickPraise: points.quickPraise,
  punish: points.punish,
  signIn: points.signIn,
  listTransactions: transactions.listTransactions,
  // 碎片盲盒
  blindBoxGet: blindbox.blindBoxGet,
  blindBoxUpload: blindbox.blindBoxUpload,
  // 心愿 & 商城
  createWish: wish.createWish,
  cancelWish: wish.cancelWish,
  claimWish: wish.claimWish,
  instantRedeem: wish.instantRedeem,
  // 冷暴力预警
  sendColdReminder: cold.sendColdReminder,
  // 积分削减机制（超期未互动惩罚）
  checkDecay: decay.checkDecay,
  // 点滴
  createMoment: moments.createMoment,
  updateMoment: moments.updateMoment,
  deleteMoment: moments.deleteMoment,
  listMoments: moments.listMoments,
  addComment: moments.addComment,
  deleteComment: moments.deleteComment,
  // 约会盲盒
  dateboxGet: datebox.dateboxGet,
  dateboxAuth: datebox.dateboxAuth,
  dateboxSelect: datebox.dateboxSelect,
  dateboxConfirm: datebox.dateboxConfirm,
  dateboxDraw: datebox.dateboxDraw,
  dateboxAccept: datebox.dateboxAccept,
  dateboxReset: datebox.dateboxReset,
  // 反向合影（拼图挑战）
  puzzleGet: puzzle.puzzleGet,
  puzzleUpload: puzzle.puzzleUpload,
  puzzleGetStreak: puzzle.puzzleGetStreak,
  puzzleGetPosterData: puzzle.puzzleGetPosterData,
  // 游戏大厅（五子棋、围棋、飞行棋、海战棋）
  gameLobbyGet: game.gameLobbyGet,
  gameGet: game.gameGet,
  gameMove: game.gameMove,
  gameRollDice: game.gameRollDice,
  gameSeaAttack: game.gameSeaAttack,
  gamePass: game.gamePass,
  gameResign: game.gameResign,
  gameReset: game.gameReset,
  // 查找（情侣共享定位与朝向）
  locationGet: location.locationGet,
  locationToggleShare: location.locationToggleShare,
  locationUpdate: location.locationUpdate,
  // 双人共养虚拟桌宠
  petGet: pet.petGet,
  petInteract: pet.petInteract,
  petRename: pet.petRename,
  // 余额实时同步
  getBalances,
}

exports.main = async (event) => {
  // 首次调用即自动创建所有集合，避免「collection not exists」报错
  await ensureCollections()

  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const handler = HANDLERS[action]
  if (!handler) return { code: -1, msg: '未知操作: ' + action }

  try {
    const result = await handler(event, { OPENID })
    return result || { code: 0, msg: 'ok' }
  } catch (err) {
    console.error(`[${action}]`, err)
    return { code: -1, msg: err.message || '服务器繁忙，请稍后再试' }
  }
}
