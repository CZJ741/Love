// 恋爱清单 / 专属心愿清单 业务模块
const { cloud, db, _, getUserByOpenid } = require('./helpers')
const { checkText, checkImages } = require('./secCheck')

// 批量换取临时图片访问链接
async function resolveImageUrls(items) {
  const fileIds = []
  items.forEach(it => {
    if (Array.isArray(it.images)) {
      it.images.forEach(f => {
        if (typeof f === 'string' && f.startsWith('cloud://')) fileIds.push(f)
      })
    }
  })
  if (!fileIds.length) return items

  try {
    const res = await cloud.getTempFileURL({ fileList: fileIds })
    const map = {}
    ;(res.fileList || []).forEach(f => {
      if (f.fileID) map[f.fileID] = f.tempFileURL || f.fileID
    })
    return items.map(it => ({
      ...it,
      imageUrls: (it.images || []).map(f => map[f] || f)
    }))
  } catch (err) {
    console.error('getTempFileURL error', err)
    return items.map(it => ({
      ...it,
      imageUrls: it.images || []
    }))
  }
}

// 1. 获取恋爱清单（所有待办事项由用户自行添加，不设默认预置事项）
async function loveList_get(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  // 获取该房间全部清单项目
  const p1 = db.collection('love_lists').where({ roomId }).orderBy('itemIndex', 'asc').limit(100).get()
  const p2 = db.collection('love_lists').where({ roomId }).orderBy('itemIndex', 'asc').skip(100).limit(100).get()
  const [res1, res2] = await Promise.all([p1, p2])
  let list = [...(res1.data || []), ...(res2.data || [])]

  // 解析打卡凭证临时链接
  list = await resolveImageUrls(list)

  const total = list.length
  const doneCount = list.filter(i => i.done).length

  return {
    code: 0,
    data: {
      total,
      doneCount,
      list
    }
  }
}

// 2. 打卡完成某一项 / 取消打卡（带图片凭证与回忆心得审核）
async function loveList_check(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const { id, done, remark = '', images = [] } = event
  if (!id) throw new Error('缺少项目ID')

  const docRes = await db.collection('love_lists').doc(id).get().catch(() => null)
  if (!docRes || !docRes.data || docRes.data.roomId !== roomId) {
    throw new Error('未找到该清单项')
  }

  if (!done) {
    // 取消打卡
    await db.collection('love_lists').doc(id).update({
      data: {
        done: false,
        doneAt: null,
        doneBy: null
      }
    })
    return { code: 0, msg: '已重置打卡状态' }
  }

  // 完成打卡：进行文字与图片安全审核
  const cleanRemark = String(remark || '').trim().slice(0, 200)
  if (cleanRemark) {
    await checkText(cleanRemark, { openid: OPENID, scene: 2 })
  }

  const validImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 9) : []
  if (validImages.length > 0) {
    await checkImages(validImages)
  }

  const itemData = docRes.data

  const nowCn = new Date(Date.now() + 8 * 3600 * 1000)
  const todayStr = nowCn.toISOString().slice(0, 10)

  await db.collection('love_lists').doc(id).update({
    data: {
      done: true,
      doneAt: todayStr,
      doneBy: OPENID,
      images: validImages,
      remark: cleanRemark
    }
  })

  // 自动同步至时间轴（moments 点滴）
  try {
    const momentText = cleanRemark
      ? `【达成心愿】${itemData.title}\n${cleanRemark}`
      : `【达成心愿】${itemData.title} 💕`

    await db.collection('moments').add({
      data: {
        roomId: me.roomId,
        openid: me.openid,
        nickname: me.nickname,
        avatar: me.avatar,
        text: momentText,
        images: validImages,
        comments: [],
        createdAt: db.serverDate()
      }
    })
  } catch (syncErr) {
    console.error('[loveList_check] 自动同步时间轴异常:', syncErr)
    // 同步时间轴失败不阻断打卡成功主流程
  }

  return { code: 0, msg: '点亮成功！💕' }
}

// 3. 追加专属心愿待办事项
async function loveList_add(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const title = String(event.title || '').trim().slice(0, 40)
  if (!title) throw new Error('请输入待办事项内容')

  await checkText(title, { openid: OPENID, scene: 1 })

  // 获取当前最大序号，若首次添加从 0 开始自增为 1
  const maxRes = await db.collection('love_lists')
    .where({ roomId })
    .orderBy('itemIndex', 'desc')
    .limit(1)
    .get()
  const maxIndex = (maxRes.data && maxRes.data[0] && maxRes.data[0].itemIndex) || 0

  const res = await db.collection('love_lists').add({
    data: {
      roomId,
      itemIndex: maxIndex + 1,
      title,
      done: false,
      doneAt: null,
      doneBy: null,
      images: [],
      remark: '',
      createdAt: db.serverDate()
    }
  })

  return { code: 0, msg: '已添加待办', data: { _id: res._id } }
}

// 4. 删除待办事项
async function loveList_delete(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  const { id } = event
  if (!id) throw new Error('缺少项目ID')

  const docRes = await db.collection('love_lists').doc(id).get().catch(() => null)
  if (!docRes || !docRes.data || docRes.data.roomId !== roomId) {
    throw new Error('未找到该清单项')
  }

  await db.collection('love_lists').doc(id).remove()
  return { code: 0, msg: '已删除' }
}

// 5. 将当前所有待办事项全部重置为未完成状态（取消全部已完成）
async function loveList_reset_all_done(event, { OPENID }) {
  const me = await getUserByOpenid(OPENID)
  if (!me) throw new Error('请先创建档案')
  if (!me.roomId) throw new Error('未加入小窝')
  const roomId = me.roomId

  // 查出该房间已完成的事项并重置
  const res = await db.collection('love_lists').where({ roomId, done: true }).limit(100).get()
  const tasks = (res.data || []).map(item => db.collection('love_lists').doc(item._id).update({
    data: {
      done: false,
      doneAt: null,
      doneBy: null
    }
  }))
  await Promise.all(tasks)

  return { code: 0, msg: '已全部取消完成' }
}

module.exports = {
  loveList_get,
  loveList_check,
  loveList_add,
  loveList_delete,
  loveList_reset_all_done
}
