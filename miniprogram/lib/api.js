// 云函数统一调用封装：把 callFunction 的返回包装成 Promise，并统一抛出业务错误
function call(action, data = {}) {
  return wx.cloud.callFunction({ name: 'api', data: { action, ...data } }).then(res => {
    const r = (res && res.result) || {}
    if (r.code !== 0) {
      const err = new Error(r.msg || '操作失败')
      err.code = r.code
      throw err
    }
    return r.data
  })
}

module.exports = { call }
