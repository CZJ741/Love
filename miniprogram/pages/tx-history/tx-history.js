// 积分变动历史
const realtime = require('../../lib/realtime')
const { formatTxTime, typeMeta } = require('../../utils/format')

Page({
  data: {
    txList: [],
    txFilterStart: '',
    txFilterEnd: '',
  },

  onShow() {
    this.loadAll()
  },

  loadAll() {
    const all = realtime.getTransactions()
    const list = all.map(t => ({
      ...t,
      _time: formatTxTime(t.createdAt),
      _meta: typeMeta(t.type),
    }))
    this.setData({ txList: list })
  },

  onTxFilterStart(e) { this.setData({ txFilterStart: e.detail.value }) },
  onTxFilterEnd(e) { this.setData({ txFilterEnd: e.detail.value }) },

  applyFilter() {
    const { txFilterStart, txFilterEnd } = this.data
    const all = realtime.getTransactions()
    let filtered = all
    if (txFilterStart) {
      const startTs = new Date(txFilterStart.replace(/-/g, '/') + ' 00:00:00').getTime()
      filtered = filtered.filter(t => new Date(t.createdAt).getTime() >= startTs)
    }
    if (txFilterEnd) {
      const endTs = new Date(txFilterEnd.replace(/-/g, '/') + ' 23:59:59').getTime()
      filtered = filtered.filter(t => new Date(t.createdAt).getTime() <= endTs)
    }
    const txList = filtered.map(t => ({
      ...t,
      _time: formatTxTime(t.createdAt),
      _meta: typeMeta(t.type),
    }))
    this.setData({ txList })
  },

  resetFilter() {
    this.setData({ txFilterStart: '', txFilterEnd: '' })
    this.loadAll()
  },
})
