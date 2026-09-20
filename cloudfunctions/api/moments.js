// 点滴（二人社区）：发帖 / 列表 / 编辑
const { db, _, cloud, getUserByOpenid } = require('./helpers')

// 收集图片数组里所有 cloud:// fileID（去重）
function collectImageFiles(list) {
  const set = new Set()
  list.forEach(m => {
    ;(m.images || []).forEach(v => {
      if (typeof v === 'string' && v.indexOf('cloud://') === 0) set.add(v)
    })
  })
  return [...set]
}

// 为每条动态补充 imageUrls（临时链接，用于展示）。默认云存储「仅创建者可读」，
// 另一半读不到对方上传的图，这里用云函数（管理员态）换取人人可访问的临时 URL；
// 原始 images（cloud:// fileID）保持不变，供编辑保存时继续使用。
async function withImageUrls(list) {
  const fileIDs = collectImageFiles(list)
  let urlMap = {}
  if (fileIDs.length) {
    try {
      const res = await cloud.getTempFileURL({ fileList: fileIDs })
      ;((res && res.fileList) || []).forEach(it => {
        if (it && it.fileID && it.tempFileURL) urlMap[it.fileID] = it.tempFileURL
      })
    } catch (e) {
      console.error('[moments] getTempFileURL error', e)
    }
  }

  return list.map(m => ({
    ...m,
    imageUrls: (m.images || []).map(img => urlMap[img] || img),
  }))
}

// 创建一条动态
async function createMoment(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const text = String(event.text || '').slice(0, 500)
  const images = event.images || []
  const customTime = String(event.customTime || '')

  let createdAt
  if (customTime) {
    const m = customTime.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/)
    if (m) {
      const iso = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5].padStart(2,'0')}:00+08:00`
      createdAt = new Date(iso)
    }
  }
  if (!createdAt || isNaN(createdAt.getTime())) {
    createdAt = null
  }

  const addRes = await db.collection('moments').add({
    data: {
      roomId: me.roomId,
      openid: me.openid,
      nickname: me.nickname,
      avatar: me.avatar,
      text,
      images,
      comments: [],
      createdAt: createdAt || db.serverDate(),
    },
  })
  const doc = await db.collection('moments').doc(addRes._id).get()
  const storedAt = (doc && doc.data && doc.data.createdAt) ? doc.data.createdAt : null
  let ts = Date.now()
  if (storedAt) {
    if (storedAt instanceof Date) ts = storedAt.getTime()
    else if (typeof storedAt === 'number') ts = storedAt < 1e12 ? storedAt * 1000 : storedAt
    else if (typeof storedAt === 'string') { const d = new Date(storedAt); if (!isNaN(d.getTime())) ts = d.getTime() }
  }
  return { code: 0, msg: '发布成功', data: { _id: addRes._id, _createdAt: ts } }
}

// 编辑动态（仅发帖人可修改）
async function updateMoment(event, ctx) {
  const { OPENID } = ctx
  const { momentId, text, images } = event
  if (!momentId) throw new Error('缺少动态ID')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const doc = await db.collection('moments').doc(momentId).get()
  if (!doc || !doc.data) throw new Error('动态不存在')
  if (doc.data.openid !== OPENID) throw new Error('只能修改自己的日记哦~')

  const updateData = {}
  if (text !== undefined) updateData.text = String(text || '').slice(0, 500)
  if (images !== undefined) updateData.images = images || []

  if (Object.keys(updateData).length === 0) throw new Error('没有要修改的内容')

  await db.collection('moments').doc(momentId).update({ data: updateData })

  return { code: 0, msg: '修改成功', data: { _id: momentId, ...updateData } }
}

// 删除动态（仅发帖人可删除，同时清理云存储图片）
async function deleteMoment(event, ctx) {
  const { OPENID } = ctx
  const { momentId } = event
  if (!momentId) throw new Error('缺少动态ID')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const doc = await db.collection('moments').doc(momentId).get()
  if (!doc || !doc.data) throw new Error('动态不存在或已被删除')
  if (doc.data.openid !== OPENID) throw new Error('只能删除自己的日记哦~')

  // 如果有云存储图片，尝试清理释放空间
  const images = doc.data.images || []
  const cloudFiles = images.filter(v => typeof v === 'string' && v.indexOf('cloud://') === 0)
  if (cloudFiles.length) {
    try {
      await cloud.deleteFile({ fileList: cloudFiles })
    } catch (e) {
      console.error('[moments] deleteFile error', e)
    }
  }

  await db.collection('moments').doc(momentId).remove()
  return { code: 0, msg: '已删除日记', data: { _id: momentId } }
}

// 获取房间内所有点滴动态
async function listMoments(event, ctx) {
  const { OPENID } = ctx
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const res = await db.collection('moments')
    .where({ roomId: me.roomId })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()

  const list = await withImageUrls(res.data)
  return { code: 0, msg: 'ok', data: list }
}

// 发表评论
async function addComment(event, ctx) {
  const { OPENID } = ctx
  const { momentId, text } = event
  if (!momentId) throw new Error('缺少动态ID')
  if (!text || !String(text).trim()) throw new Error('评论内容不能为空')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const doc = await db.collection('moments').doc(momentId).get()
  if (!doc || !doc.data) throw new Error('动态不存在')
  if (doc.data.roomId !== me.roomId) throw new Error('无权访问该动态')

  const comment = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    openid: me.openid,
    author: me.nickname || '神秘人',
    avatar: me.avatar || '🐰',
    text: String(text).trim().slice(0, 200),
    createdAt: new Date(),
  }

  await db.collection('moments').doc(momentId).update({
    data: {
      comments: _.push([comment]),
    },
  })

  return { code: 0, msg: '评论成功', data: comment }
}

// 删除评论（评论发布者或动态作者可删）
async function deleteComment(event, ctx) {
  const { OPENID } = ctx
  const { momentId, commentId } = event
  if (!momentId || !commentId) throw new Error('参数不完整')

  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')

  const doc = await db.collection('moments').doc(momentId).get()
  if (!doc || !doc.data) throw new Error('动态不存在')
  if (doc.data.roomId !== me.roomId) throw new Error('无权访问该动态')

  const comments = doc.data.comments || []
  const target = comments.find(c => c.id === commentId)
  if (!target) throw new Error('评论不存在或已被删除')

  // 校验权限：仅评论作者或动态作者可删除
  if (target.openid !== OPENID && doc.data.openid !== OPENID) {
    throw new Error('只能删除自己发表的评论或自己帖子下的评论')
  }

  await db.collection('moments').doc(momentId).update({
    data: {
      comments: _.pull({ id: commentId }),
    },
  })

  return { code: 0, msg: '删除成功', data: { commentId } }
}

module.exports = { createMoment, updateMoment, deleteMoment, listMoments, addComment, deleteComment }
