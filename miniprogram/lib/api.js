// 云函数统一调用封装：把 callFunction 的返回包装成 Promise，并统一抛出业务错误
function call(action, data = {}) {
  // 必须保证顶层路由 action 不被 data 内部同名属性无意覆盖
  return wx.cloud.callFunction({ name: 'api', data: { ...data, action } }).then(res => {
    const r = (res && res.result) || {}
    if (r.code !== 0) {
      console.error(`[api.call error] action=${action}:`, r)
      const err = new Error(r.msg || '操作失败')
      err.code = r.code
      throw err
    }
    return r.data
  }).catch(err => {
    console.error(`[api.call failed] action=${action}:`, err)
    throw err
  })
}

module.exports = { call }
