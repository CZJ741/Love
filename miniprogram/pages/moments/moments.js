// 时间轴：两人专属日记。发帖子支持文本+图片，自动时间也可手动填写。
const api = require('../../lib/api')
const realtime = require('../../lib/realtime')
const { isCloudFile } = require('../../utils/format')
const { uploadImageWithCompress } = require('../../lib/image')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 统一将 createdAt 转为毫秒时间戳，兼容 Date / 毫秒 / 秒级 / ISO 字符串 / 云数据库特殊格式
function parseTs(v) {
  if (!v) return 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') { const d = new Date(v); if (!isNaN(d.getTime())) return d.getTime() }
  // 云数据库可能返回 {$date: ...} 对象
  if (v.$date) return parseTs(v.$date)
  return 0
}
function parseDate(v) {
  const ts = parseTs(v)
  return ts ? new Date(ts) : new Date()
}

// 格式化评论友好时间
function formatCommentTime(ts) {
  const t = parseTs(ts)
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 24 * 3600 * 1000) return Math.floor(diff / 3600000) + '小时前'
  const d = new Date(t)
  const now = new Date()
  const isSameYear = d.getFullYear() === now.getFullYear()
  const pad = n => (n < 10 ? '0' + n : '' + n)
  const monthDay = `${d.getMonth() + 1}月${d.getDate()}日`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return isSameYear ? `${monthDay} ${time}` : `${d.getFullYear()}年${monthDay}`
}

// 往年今日候选时间段（天）
const MEMORY_PERIODS = [3, 7, 30, 60, 90, 180, 365]
const MEMORY_LABELS = {
  3: '来自3天前', 7: '来自7天前',
  30: '来自1个月前', 60: '来自2个月前',
  90: '来自3个月前', 180: '来自半年前',
  365: '来自1年前',
}

// 用种子生成确定性的伪随机数：同一天内卡片稳定，不会每次刷新都变
function seededRandom(seed) {
  let t = seed
  return function () {
    t = (t * 9301 + 49297) % 233280
    return t / 233280
  }
}
function shuffleSeeded(arr, rnd) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

Page({
  data: {
    me: null,
    moments: [],
    groupedMoments: [],
    todayDate: '',
    totalCount: 0,
    memoryCard: null, // 往年今日随机卡片
    loading: true,
    // 日历
    showCalendar: false,
    calYear: 0,
    calMonth: 0,
    calWeeks: [],
    markedDates: {},
    // 发帖
    showPost: false,
    postText: '',
    postImages: [], // [{temp, cloudId}]
    postDate: '',
    postTime: '',
    posting: false,
    // 详情
    showDetail: false,
    detailItem: null,
    // 评论
    commentInput: '',
    submittingComment: false,
    // 编辑
    editMode: false,
    editText: '',
    editImages: [],
    editing: false,
  },

  onLoad() {
    this._mcb = realtime.on('moments', this.refresh.bind(this))
    this._loadData()
  },
  onShow() {
    realtime.heartbeat()
    this._loadData()
  },
  onReady() {
    if (!this.data.moments.length) {
      this._loadData()
    }
  },
  onUnload() {
    realtime.off('moments', this._mcb)
  },

  _loadData() {
    const me = realtime.getMe()
    if (!me) {
      realtime.fetchOnce().then(() => this.refresh()).catch(() => this.refresh())
    } else {
      this.refresh()
      realtime.fetchMoments().catch(() => {})
    }
  },

  onPullDownRefresh() {
    realtime.fetchMoments().then(() => {
      this.refresh()
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },

  refresh() {
    const me = realtime.getMe()
    let list = (realtime.getMoments ? realtime.getMoments() : []).slice()

    // 展示用图片统一走 imageUrls（云函数返回的临时链接），兜底用原始 images
    list = list.map(m => ({ ...m, imageUrls: m.imageUrls || m.images || [] }))

    // 客户端按时间倒序排序
    list.sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt))

    const grouped = this._buildGrouped(list)
    const today = new Date()
    const todayDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${WEEKDAYS[today.getDay()]}`
    const memoryCard = this._pickMemory(list)
    const markedDates = this._buildMarkedDates(list)

    console.log('[moments] refresh:', list.length, 'posts')

    this.setData({
      me,
      moments: list,
      groupedMoments: grouped,
      todayDate,
      totalCount: list.length,
      memoryCard,
      loading: false,
      markedDates,
    })
  },

  // 构建时间轴列表
  _buildGrouped(list) {
    const me = realtime.getMe()
    const partner = realtime.getPartner()
    const grouped = []
    list.forEach((m, idx) => {
      const d = parseDate(m.createdAt)
      const hours = String(d.getHours()).padStart(2, '0')
      const minutes = String(d.getMinutes()).padStart(2, '0')
      // 用当前最新头像替换帖子中存储的旧头像
      const isMe = me && m.openid === me.openid
      const author = isMe ? me : (partner && m.openid === partner.openid ? partner : null)
      const avatar = author ? author.avatar : (m.avatar || '📝')
      const comments = (m.comments || []).map(c => {
        const cAuthor = me && c.openid === me.openid ? me : (partner && c.openid === partner.openid ? partner : null)
        const cAvatar = cAuthor ? cAuthor.avatar : (c.avatar || '🐰')
        const cName = cAuthor ? (cAuthor.nickname || cAuthor.name) : (c.author || '神秘人')
        return {
          ...c,
          author: cName,
          avatar: cAvatar,
          avatarImg: isCloudFile(cAvatar),
          timeStr: formatCommentTime(c.createdAt),
          canDelete: (me && c.openid === me.openid) || (me && m.openid === me.openid),
        }
      })
      grouped.push({
        ...m,
        key: m._id,
        _origIdx: idx,
        avatar,
        avatarImg: isCloudFile(avatar),
        comments,
        commentCount: comments.length,
        dayStr: String(d.getDate()).padStart(2, '0'),
        monthStr: (d.getMonth() + 1) + '月',
        weekdayStr: WEEKDAYS[d.getDay()],
        timeStr: `${hours}:${minutes}`,
        dateKey: `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`,
      })
    })
    return grouped
  },

  // 随机抽取一条往年今日记忆（按当天日期做种子，同一天内稳定不变）
  _pickMemory(list) {
    if (!list.length) return null
    const now = new Date()
    const nowTs = now.getTime()
    const dayMs = 24 * 60 * 60 * 1000

    const pad = n => String(n).padStart(2, '0')
    const seed = Number(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
    const rnd = seededRandom(seed)

    // 打乱候选时间段
    const periods = shuffleSeeded(MEMORY_PERIODS, rnd)

    for (const days of periods) {
      const targetTs = nowTs - days * dayMs
      // 在目标时间 ±1 天内查找
      const margin = dayMs
      const candidates = list.filter(m => {
        const ts = parseTs(m.createdAt)
        return Math.abs(ts - targetTs) <= margin
      })
      if (candidates.length) {
        const pick = candidates[Math.floor(rnd() * candidates.length)]
        return {
          _id: pick._id,
          text: (pick.text || '').slice(0, 100),
          agoText: MEMORY_LABELS[days] || `来自${days}天前`,
          bgImg: (pick.imageUrls && pick.imageUrls.length) ? pick.imageUrls[0] : '',
        }
      }
    }
    return null
  },

  // 构建有日记的日期集合 { '20260811': true, ... }
  _buildMarkedDates(list) {
    const map = {}
    list.forEach(m => {
      const d = parseDate(m.createdAt)
      const key = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
      map[key] = true
    })
    return map
  },

  // 点击导航日期 → 打开/关闭日历，默认显示当月
  toggleCalendar() {
    if (this.data.showCalendar) {
      this.setData({ showCalendar: false })
    } else {
      const now = new Date()
      this.setData({ showCalendar: true })
      this._renderCalendar(now.getFullYear(), now.getMonth() + 1)
    }
  },

  _renderCalendar(year, month) {
    const marked = this.data.markedDates || {}
    const today = new Date()
    const todayKey = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`

    // 当月第一天和最后一天
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const daysInMonth = lastDay.getDate()
    const startDow = firstDay.getDay() || 7 // 周一=1 ... 周日=7

    const weeks = []
    let week = []
    // 前导空白
    for (let i = 1; i < startDow; i++) {
      week.push({ empty: true })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}${String(month).padStart(2,'0')}${String(d).padStart(2,'0')}`
      week.push({
        empty: false,
        day: d,
        dateStr: dateKey,
        hasEntry: !!marked[dateKey],
        isToday: dateKey === todayKey,
      })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
    }
    // 末尾补齐
    if (week.length) {
      while (week.length < 7) week.push({ empty: true })
      weeks.push(week)
    }

    this.setData({ calYear: year, calMonth: month, calWeeks: weeks })
  },

  prevMonth() {
    let { calYear, calMonth } = this.data
    if (calMonth === 1) { calYear--; calMonth = 12 }
    else calMonth--
    this._renderCalendar(calYear, calMonth)
  },

  nextMonth() {
    let { calYear, calMonth } = this.data
    if (calMonth === 12) { calYear++; calMonth = 1 }
    else calMonth++
    this._renderCalendar(calYear, calMonth)
  },

  onCalDayTap(e) {
    const dateStr = e.currentTarget.dataset.date
    const marked = this.data.markedDates || {}
    if (!marked[dateStr]) return // 没有日记的日期不跳转

    this.setData({ showCalendar: false })
    // 延迟等日历收起后滚动
    setTimeout(() => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#tx-day-' + dateStr).boundingClientRect()
      query.selectViewport().scrollOffset()
      query.exec(res => {
        if (res && res[0]) {
          const top = res[0].top + (res[1] ? res[1].scrollTop : 0) - 20
          wx.pageScrollTo({ scrollTop: top, duration: 300 })
        }
      })
    }, 300)
  },

  // 点击往年今日卡片 → 打开详情
  onMemoryTap() {
    const card = this.data.memoryCard
    if (!card || !card._id) return
    const m = this.data.moments.find(x => x._id === card._id)
    if (!m) return
    const d = parseDate(m.createdAt)
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    this.setData({
      showDetail: true,
      editMode: false,
      detailItem: {
        ...m,
        dayStr: String(d.getDate()).padStart(2, '0'),
        monthStr: (d.getMonth() + 1) + '月',
        weekdayStr: WEEKDAYS[d.getDay()],
        timeStr: `${hours}:${minutes}`,
      },
    })
  },

  // ======== 发帖 ========
  openPost() {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const postDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const postTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`

    this.setData({
      showPost: true, postText: '', postImages: [], postDate, postTime,
    })
  },
  closePost() { this.setData({ showPost: false }) },

  onText(e) { this.setData({ postText: e.detail.value }) },
  onDateChange(e) { this.setData({ postDate: e.detail.value }) },
  onTimeChange(e) { this.setData({ postTime: e.detail.value }) },

  chooseImage() {
    const remain = 9 - this.data.postImages.length
    if (remain <= 0) return wx.showToast({ title: '最多9张图', icon: 'none' })

    // 隐私接口授权检查（微信 2023 隐私政策要求，适用于 Album）
    const doChoose = () => {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: res => {
          const imgs = this.data.postImages.slice()
          res.tempFiles.forEach(f => imgs.push({ temp: f.tempFilePath, cloudId: '' }))
          this.setData({ postImages: imgs })
        },
      })
    }

    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: doChoose,
        fail: () => {
          wx.showToast({ title: '需要相册权限才能上传照片', icon: 'none' })
        },
      })
    } else {
      doChoose()
    }
  },
  removeImage(e) {
    const idx = e.currentTarget.dataset.idx
    const imgs = this.data.postImages.slice()
    imgs.splice(idx, 1)
    this.setData({ postImages: imgs })
  },

  async submitPost() {
    const { postText, postImages, posting } = this.data
    if (posting) return
    if (!postText.trim() && !postImages.length) return wx.showToast({ title: '写点什么吧~', icon: 'none' })

    this.setData({ posting: true })
    wx.showLoading({ title: '发布中...' })

    try {
      const uploaded = []
      for (const img of postImages) {
        if (img.cloudId) { uploaded.push(img.cloudId); continue }
        // 智能阶梯压缩至约 100KB 后再上传云存储
        const fileId = await uploadImageWithCompress(img.temp, 'moments')
        uploaded.push(fileId)
      }

      const customTime = (this.data.postDate && this.data.postTime)
        ? `${this.data.postDate} ${this.data.postTime}`
        : ''
      const me = realtime.getMe()
      const result = await api.call('createMoment', {
        text: postText.trim(),
        images: uploaded,
        customTime,
      })

      wx.hideLoading()
      this.setData({ showPost: false, posting: false })
      wx.showToast({ title: '发布成功~', icon: 'success' })

      if (me && result && result._id) {
        const nowTs = result._createdAt || Date.now()
        realtime.prependMoment({
          _id: result._id,
          roomId: me.roomId,
          openid: me.openid,
          nickname: me.nickname,
          avatar: me.avatar,
          text: postText.trim(),
          images: uploaded,
          createdAt: typeof nowTs === 'number' ? nowTs : parseTs(nowTs),
        })
      }
      realtime.fetchMoments()
      realtime.heartbeat()
    } catch (e) {
      wx.hideLoading()
      this.setData({ posting: false })
      console.error('[moments] submitPost error:', e)
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
    }
  },

  // ======== 详情 ========
  onTap(e) {
    const idx = e.currentTarget.dataset.idx
    const m = this.data.moments[idx]
    if (!m) return
    const d = parseDate(m.createdAt)
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const me = realtime.getMe()
    const partner = realtime.getPartner()
    const comments = (m.comments || []).map(c => {
      const cAuthor = me && c.openid === me.openid ? me : (partner && c.openid === partner.openid ? partner : null)
      const cAvatar = cAuthor ? cAuthor.avatar : (c.avatar || '🐰')
      const cName = cAuthor ? (cAuthor.nickname || cAuthor.name) : (c.author || '神秘人')
      return {
        ...c,
        author: cName,
        avatar: cAvatar,
        avatarImg: isCloudFile(cAvatar),
        timeStr: formatCommentTime(c.createdAt),
        canDelete: (me && c.openid === me.openid) || (me && m.openid === me.openid),
      }
    })
    this.setData({
      showDetail: true,
      editMode: false,
      commentInput: '',
      detailItem: {
        ...m,
        comments,
        commentCount: comments.length,
        dayStr: String(d.getDate()).padStart(2, '0'),
        monthStr: (d.getMonth() + 1) + '月',
        weekdayStr: WEEKDAYS[d.getDay()],
        timeStr: `${hours}:${minutes}`,
      },
    })
  },
  closeDetail() { this.setData({ showDetail: false, editMode: false, commentInput: '' }) },

  // ======== 评论功能 ========
  onCommentInput(e) {
    this.setData({ commentInput: e.detail.value })
  },

  sendComment() {
    const { detailItem, commentInput, submittingComment } = this.data
    if (submittingComment) return
    if (!detailItem || !detailItem._id) return

    const text = (commentInput || '').trim()
    if (!text) {
      return wx.showToast({ title: '写点什么吧~', icon: 'none' })
    }

    this.setData({ submittingComment: true })
    wx.showLoading({ title: '发送中...' })

    api.call('addComment', { momentId: detailItem._id, text })
      .then(res => {
        wx.hideLoading()
        this.setData({ submittingComment: false, commentInput: '' })
        wx.showToast({ title: '评论成功', icon: 'success' })

        // 本地实时构造新评论追加到当前详情弹窗中
        const me = realtime.getMe()
        const newComment = res.data || {}
        const enrichedComment = {
          ...newComment,
          author: me ? (me.nickname || me.name) : (newComment.author || '我'),
          avatar: me ? me.avatar : (newComment.avatar || '🐰'),
          avatarImg: isCloudFile(me ? me.avatar : newComment.avatar),
          timeStr: '刚刚',
          canDelete: true,
        }
        const updatedComments = [...(detailItem.comments || []), enrichedComment]
        this.setData({
          'detailItem.comments': updatedComments,
          'detailItem.commentCount': updatedComments.length,
        })

        // 后台刷新整体 moments
        realtime.fetchMoments()
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ submittingComment: false })
        console.error('[moments] addComment error:', err)
        wx.showToast({ title: err.message || '评论失败', icon: 'none' })
      })
  },

  deleteComment(e) {
    const commentId = e.currentTarget.dataset.id
    const { detailItem } = this.data
    if (!detailItem || !detailItem._id || !commentId) return

    wx.showModal({
      title: '删除评论',
      content: '确定要删除这条评论吗？',
      confirmColor: '#E74C3C',
      confirmText: '删除',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          api.call('deleteComment', { momentId: detailItem._id, commentId })
            .then(() => {
              wx.hideLoading()
              wx.showToast({ title: '已删除', icon: 'success' })

              // 本地更新当前详情弹窗
              const updatedComments = (detailItem.comments || []).filter(c => c.id !== commentId)
              this.setData({
                'detailItem.comments': updatedComments,
                'detailItem.commentCount': updatedComments.length,
              })

              // 后台刷新整体 moments
              realtime.fetchMoments()
            })
            .catch(err => {
              wx.hideLoading()
              console.error('[moments] deleteComment error:', err)
              wx.showToast({ title: err.message || '删除失败', icon: 'none' })
            })
        }
      },
    })
  },

  // ======== 编辑日记 ========
  startEdit() {
    const item = this.data.detailItem
    if (!item) return
    this.setData({
      editMode: true,
      editText: item.text || '',
      editImages: (item.images || []).slice(),
    })
  },
  cancelEdit() { this.setData({ editMode: false }) },
  onEditText(e) { this.setData({ editText: e.detail.value }) },

  chooseEditImage() {
    const remain = 9 - this.data.editImages.length
    if (remain <= 0) return wx.showToast({ title: '最多9张图', icon: 'none' })
    const doChoose = () => {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: res => {
          const imgs = this.data.editImages.slice()
          res.tempFiles.forEach(f => imgs.push(f.tempFilePath))
          this.setData({ editImages: imgs })
        },
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doChoose, fail: () => wx.showToast({ title: '需要相册权限', icon: 'none' }) })
    } else {
      doChoose()
    }
  },
  removeEditImage(e) {
    const idx = e.currentTarget.dataset.idx
    const imgs = this.data.editImages.slice()
    imgs.splice(idx, 1)
    this.setData({ editImages: imgs })
  },

  async saveEdit() {
    const { detailItem, editText, editImages, editing } = this.data
    if (editing || !detailItem) return

    this.setData({ editing: true })
    wx.showLoading({ title: '保存中...' })

    try {
      const uploaded = []
      for (const img of editImages) {
        if (img.startsWith('cloud://')) { uploaded.push(img); continue }
        // 智能阶梯压缩至约 100KB 后再上传云存储
        const fileId = await uploadImageWithCompress(img, 'moments')
        uploaded.push(fileId)
      }

      await api.call('updateMoment', {
        momentId: detailItem._id,
        text: editText.trim(),
        images: uploaded,
      })

      wx.hideLoading()
      this.setData({ showDetail: false, editMode: false, editing: false })
      wx.showToast({ title: '修改成功~', icon: 'success' })
      realtime.fetchMoments()
    } catch (e) {
      wx.hideLoading()
      this.setData({ editing: false })
      console.error('[moments] saveEdit error:', e)
      wx.showToast({ title: e.message || '修改失败', icon: 'none' })
    }
  },

  // -------- 删除日记帖子 --------
  confirmDelete() {
    const detailItem = this.data.detailItem
    if (!detailItem || !detailItem._id) return

    wx.showModal({
      title: '删除日记',
      content: '确定要删除这条日记吗？删除后将无法找回哦。',
      confirmColor: '#E74C3C',
      confirmText: '删除',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          api.call('deleteMoment', { momentId: detailItem._id })
            .then(() => {
              wx.hideLoading()
              this.setData({ showDetail: false, editMode: false, detailItem: null })
              wx.showToast({ title: '已删除', icon: 'success' })
              realtime.fetchMoments()
            })
            .catch(err => {
              wx.hideLoading()
              console.error('[moments] deleteMoment error:', err)
              wx.showToast({ title: err.message || '删除失败', icon: 'none' })
            })
        }
      },
    })
  },

  previewImage(e) {
    const urls = e.currentTarget.dataset.urls
    const cur = e.currentTarget.dataset.cur
    wx.previewImage({ urls, current: cur })
  },

  noop() {},
})