// 清空所有业务数据（谨慎使用！）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = ['users', 'transactions', 'wishes', 'dailies', 'moments', 'rooms']

// 每次 remove 最多删 100 条，循环删除直到清空
async function clearCollection(name) {
  let total = 0
  while (true) {
    try {
      const res = await db.collection(name).where({}).limit(100).get()
      const ids = res.data.map(d => d._id)
      if (!ids.length) break

      // 批量删除
      await Promise.all(ids.map(id =>
        db.collection(name).doc(id).remove()
      ))
      total += ids.length
      console.log(`  [${name}] 已删除 ${ids.length} 条`)
    } catch (e) {
      // 集合不存在视为已清空
      if (e.errCode === -502005) {
        console.log(`  [${name}] 集合不存在，跳过`)
        break
      }
      throw e
    }
  }
  return total
}

exports.main = async () => {
  const result = {}
  let grandTotal = 0

  for (const name of COLLECTIONS) {
    console.log(`开始清空 [${name}]...`)
    const count = await clearCollection(name)
    result[name] = count
    grandTotal += count
  }

  console.log(`\n全部完成，共删除 ${grandTotal} 条数据`)
  return { code: 0, msg: `已清空 ${grandTotal} 条数据`, data: result }
}