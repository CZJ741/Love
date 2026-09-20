// 约会盲盒：双方授权 → 选标签 → 确认意愿 → 抽奖 → 双方接受
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')
const { isCloudFile } = require('../../utils/format')

const ANIM_MS = 1200 // 抽奖转盘动画时长（<1.5s）

Page({
  data: {
    phase: 'auth', // auth | select | draw | done
    hasPartner: false,
    partner: null,
    partnerAvatarImg: false,
    me: null,
    meAvatarImg: false,

    myAuthorized: false,
    partnerAuthorized: false,

    categories: [],
    tags: [], // 全量标签 [{name, cat, color}]
    tagGroups: [], // 按大类分组
    selectedMap: {}, // { 标签名: true }
    myTags: [],
    partnerTags: [],
    myConfirmed: false,
    partnerConfirmed: false,

    result: null,
    resultMode: null,
    resultTags: [], // 结果项目的标签（用于展示，剔除大类名）
    myAccepted: false,
    partnerAccepted: false,
    winner: null,
    redrawLeft: 0,

    loading: true,
    submitting: false,
    drawAnim: false,
  },

  onLoad() {
    this._timer = null
    this._hasLoaded = false
    this._lastResultName = null
    this._load()
  },
  onShow() {
    this._startPolling()
    this._load()
  },
  onHide() { this._stopPolling() },
  onUnload() { this._stopPolling() },

  _startPolling() {
    this._stopPolling()
    this._timer = setInterval(() => this._load(), 2500)
  },
  _stopPolling() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  _load() {
    api.call('dateboxGet').then(d => this._apply(d)).catch(() => {
      this.setData({ loading: false })
    })
  },

  _apply(d) {
    if (!d) return
    const prevResult = this._lastResultName
    const newResultName = d.result ? d.result.name : null

    const partner = d.partner || null
    const me = realtime.getMe() || null
    const groups = this._buildGroups(d.categories || [], d.tags || [])

    // 组装选中态 map
    const selectedMap = {}
    ;(d.myTags || []).forEach(t => { selectedMap[t] = true })

    // 结果项目的标签（去掉大类名，只展示用户可能感兴趣的标签）
    const resultTags = d.result && d.result.tags ? d.result.tags.slice(0, 6) : []

    this.setData({
      phase: d.phase,
      hasPartner: d.hasPartner,
      partner,
      partnerAvatarImg: partner ? isCloudFile(partner.avatar) : false,
      me,
      meAvatarImg: me ? isCloudFile(me.avatar) : false,
      myAuthorized: d.myAuthorized,
      partnerAuthorized: d.partnerAuthorized,
      categories: d.categories || [],
      tags: d.tags || [],
      tagGroups: groups,
      selectedMap,
      myTags: d.myTags || [],
      partnerTags: d.partnerTags || [],
      myConfirmed: d.myConfirmed,
      partnerConfirmed: d.partnerConfirmed,
      result: d.result || null,
      resultMode: d.mode || null,
      resultTags,
      myAccepted: d.myAccepted,
      partnerAccepted: d.partnerAccepted,
      winner: d.winner || null,
      redrawLeft: d.redrawLeft || 0,
      loading: false,
    })

    // 触发抽奖动效：新结果出现（首次抽取或「换一个」），跳过首次加载
    if (newResultName && newResultName !== prevResult && d.phase === 'draw') {
      if (this._hasLoaded) {
        this.setData({ drawAnim: true })
        setTimeout(() => this.setData({ drawAnim: false }), ANIM_MS)
      }
      this._lastResultName = newResultName
    }
    if (!newResultName) this._lastResultName = null
    this._hasLoaded = true
  },

  _buildGroups(categories, tags) {
    return categories.map(c => ({
      name: c.name,
      color: c.color,
      tags: tags.filter(t => t.cat === c.name),
    }))
  },

  // ======== 授权 ========
  auth() {
    this._act('dateboxAuth')
  },
  reset() {
    this._act('dateboxReset')
  },

  // ======== 标签选择 ========
  toggleTag(e) {
    const name = e.currentTarget.dataset.name
    const map = { ...this.data.selectedMap }
    const cur = Object.keys(map)
    if (map[name]) {
      delete map[name]
    } else {
      if (cur.length >= 2) return wx.showToast({ title: '最多选 2 个标签哦', icon: 'none' })
      map[name] = true
    }
    const tags = Object.keys(map)
    this.setData({ selectedMap: map })
    api.call('dateboxSelect', { tags })
      .then(d => this._apply(d))
      .catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },

  confirm() {
    if (!this.data.myTags.length) return wx.showToast({ title: '请先选择标签', icon: 'none' })
    this._act('dateboxConfirm')
  },

  // ======== 抽奖 ========
  redraw() {
    this._act('dateboxDraw')
  },
  reject() {
    this._act('dateboxDraw')
  },
  accept() {
    this._act('dateboxAccept')
  },

  _act(action, extra = {}) {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    api.call(action, extra)
      .then(d => { this.setData({ submitting: false }); this._apply(d) })
      .catch(err => {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },

  noop() {},
})
