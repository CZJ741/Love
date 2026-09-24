// 查找（情侣共享定位与朝向）页面逻辑
const api = require('../../lib/api')

// 根据角度转为易读方位（东/南/西/北等）
function degToCompass(deg) {
  const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  const idx = Math.round(deg / 45) % 8
  return directions[idx]
}

// 球面大圆距离公式（Haversine formula）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 计算从点1到点2的真实方位角（Bearing）
function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180)
  let brng = Math.atan2(y, x) * 180 / Math.PI
  return (Math.round(brng) + 360) % 360
}

// 格式化位置更新时间展示
function formatLocTime(ts) {
  if (!ts) return ''
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (isNaN(t) || t <= 0) return ''
  const now = Date.now()
  const diffSec = Math.floor((now - t) / 1000)
  if (diffSec < 60) return '刚刚'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`

  const d = new Date(t)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const nowDate = new Date()
  if (
    d.getFullYear() === nowDate.getFullYear() &&
    d.getMonth() === nowDate.getMonth() &&
    d.getDate() === nowDate.getDate()
  ) {
    return `今天 ${timeStr}`
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`
}

Page({
  data: {
    myAgreed: false,
    partnerAgreed: false,
    bothAgreed: false,

    myPos: null,
    partnerPos: null,
    me: {},
    partner: {},

    // 格式化后的双方最新位置更新时间
    myUpdatedTimeText: '',
    partnerUpdatedTimeText: '',

    // 罗盘与朝向数据
    myDirection: 0,
    directionDesc: '正北',
    distanceText: '',
    targetBearing: null,
    targetBearingDesc: '',

    // 地图显示与标注
    mapCenterLat: 39.908823,
    mapCenterLng: 116.397470,
    mapScale: 14,
    markers: [],
    myAddress: '',
  },

  onLoad() {
    this._compassRunning = false
    this.fetchData()
  },

  onShow() {
    this.fetchData(true)
    if (this.data.myAgreed) {
      this.startCompassListener()
      this.startLocationReporting()
    }
  },

  onHide() {
    this.stopCompassListener()
  },

  onUnload() {
    this.stopCompassListener()
  },

  onPullDownRefresh() {
    this.fetchData(true).finally(() => wx.stopPullDownRefresh())
  },

  // 1. 获取定位共享状态与双方数据
  fetchData(quiet = false) {
    if (!quiet) wx.showLoading({ title: '加载中...' })
    return api.call('locationGet', {})
      .then(res => {
        if (!res) return
        const { myAgreed, partnerAgreed, bothAgreed, myPos, partnerPos, me, partner } = res
        const myUpdatedTimeText = myPos && myPos.updatedAt ? formatLocTime(myPos.updatedAt) : ''
        const partnerUpdatedTimeText = partnerPos && partnerPos.updatedAt ? formatLocTime(partnerPos.updatedAt) : ''

        this.setData({
          myAgreed,
          partnerAgreed,
          bothAgreed,
          myPos,
          partnerPos,
          me: me || {},
          partner: partner || {},
          myAddress: (myPos && myPos.address) || '',
          myUpdatedTimeText,
          partnerUpdatedTimeText,
        })

        if (myAgreed) {
          this.startCompassListener()
          this.startLocationReporting()
        }

        if (bothAgreed) {
          this.updateMapAndDistance()
        }
      })
      .catch(err => {
        wx.showToast({ title: err.message || '获取定位失败', icon: 'none' })
      })
      .finally(() => {
        if (!quiet) wx.hideLoading()
      })
  },

  // 2. 开启/关闭我的共享授权
  onToggleShare(e) {
    const agreed = e.detail.value
    if (agreed) {
      this.requestLocationPermissionAndEnable()
    } else {
      this.disableShare()
    }
  },

  agreeAndEnable() {
    this.requestLocationPermissionAndEnable()
  },

  // 请求微信系统定位授权并开启
  requestLocationPermissionAndEnable() {
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => {
        this._setShareStatus(true)
      },
      fail: () => {
        wx.showModal({
          title: '需要定位权限',
          content: '请在小程序设置中允许使用位置信息，以便与伴侣共享定位与罗盘朝向。',
          confirmText: '去设置',
          success: res => {
            if (res.confirm) {
              wx.openSetting({
                success: (settingRes) => {
                  if (settingRes.authSetting['scope.userLocation']) {
                    this._setShareStatus(true)
                  }
                }
              })
            }
          }
        })
      }
    })
  },

  _setShareStatus(agreed) {
    wx.showLoading({ title: agreed ? '开启共享中...' : '关闭中...' })
    api.call('locationToggleShare', { agreed })
      .then(() => {
        this.setData({ myAgreed: agreed })
        if (agreed) {
          this.startCompassListener()
          this.startLocationReporting()
        } else {
          this.stopCompassListener()
        }
        this.fetchData(true)
        wx.showToast({ title: agreed ? '已开启位置共享' : '已关闭位置共享', icon: 'success' })
      })
      .catch(err => {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      })
      .finally(() => wx.hideLoading())
  },

  disableShare() {
    wx.showModal({
      title: '确认关闭共享',
      content: '关闭后，双方将无法在地图中看到彼此的位置与朝向，且您在云端的定位数据会被立即清空。',
      confirmColor: '#E53935',
      confirmText: '确认关闭',
      cancelText: '保持开启',
      success: res => {
        if (res.confirm) {
          this._setShareStatus(false)
        } else {
          this.setData({ myAgreed: true })
        }
      }
    })
  },

  // 3. 监听罗盘（获取当前手机朝向角度）
  startCompassListener() {
    if (this._compassRunning) return
    this._compassRunning = true
    wx.startCompass({
      success: () => {
        wx.onCompassChange(res => {
          const deg = Math.round(res.direction)
          const desc = degToCompass(deg)
          this.setData({
            myDirection: deg,
            directionDesc: desc
          })
        })
      }
    })
  },

  stopCompassListener() {
    if (!this._compassRunning) return
    this._compassRunning = false
    wx.stopCompass()
  },

  // 4. 获取本机经纬度并上报云端
  startLocationReporting() {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: res => {
        const { latitude, longitude } = res
        const direction = this.data.myDirection || 0

        const nowMs = Date.now()
        this.setData({
          mapCenterLat: latitude,
          mapCenterLng: longitude,
          myPos: { latitude, longitude, direction, updatedAt: nowMs },
          myUpdatedTimeText: formatLocTime(nowMs),
        })

        // 调用云函数更新位置与朝向
        api.call('locationUpdate', {
          latitude,
          longitude,
          direction
        }).then(() => {
          if (this.data.bothAgreed) {
            this.updateMapAndDistance()
          }
        }).catch(() => {})
      },
      fail: () => {}
    })
  },

  // 5. 更新地图标记与距离朝向计算
  updateMapAndDistance() {
    const { myPos, partnerPos, me, partner } = this.data
    if (!myPos || !partnerPos) {
      if (myPos) {
        this.setData({
          mapCenterLat: myPos.latitude,
          mapCenterLng: myPos.longitude,
          markers: [{
            id: 1,
            latitude: myPos.latitude,
            longitude: myPos.longitude,
            title: me.nickname || '我',
            callout: { content: `${me.nickname || '我'} 的位置`, display: 'ALWAYS', padding: 6, borderRadius: 12, color: '#E91E63' }
          }]
        })
      }
      return
    }

    // 计算两者直线距离
    const distMeters = calculateDistance(myPos.latitude, myPos.longitude, partnerPos.latitude, partnerPos.longitude)
    let distStr = ''
    if (distMeters < 1000) {
      distStr = `${Math.round(distMeters)} 米`
    } else {
      distStr = `${(distMeters / 1000).toFixed(2)} 公里`
    }

    // 计算面向 TA 的方位角
    const bearing = calculateBearing(myPos.latitude, myPos.longitude, partnerPos.latitude, partnerPos.longitude)
    const bearingDesc = degToCompass(bearing)

    // 构建地图标注点
    const myTimeSuffix = myPos.updatedAt ? ` (${formatLocTime(myPos.updatedAt)})` : ''
    const partnerTimeSuffix = partnerPos.updatedAt ? ` (${formatLocTime(partnerPos.updatedAt)})` : ''

    const markers = [
      {
        id: 1,
        latitude: myPos.latitude,
        longitude: myPos.longitude,
        title: me.nickname || '我',
        callout: {
          content: `📍 我${myTimeSuffix}`,
          display: 'ALWAYS',
          padding: 8,
          borderRadius: 12,
          bgColor: '#FFFFFF',
          color: '#E91E63',
          fontSize: 12
        }
      },
      {
        id: 2,
        latitude: partnerPos.latitude,
        longitude: partnerPos.longitude,
        title: partner.nickname || 'TA',
        callout: {
          content: `💕 ${partner.nickname || 'TA'}${partnerTimeSuffix}`,
          display: 'ALWAYS',
          padding: 8,
          borderRadius: 12,
          bgColor: '#FFFFFF',
          color: '#0288D1',
          fontSize: 12
        }
      }
    ]

    // 默认以双方中点作为地图中心
    const centerLat = (myPos.latitude + partnerPos.latitude) / 2
    const centerLng = (myPos.longitude + partnerPos.longitude) / 2

    this.setData({
      distanceText: distStr,
      targetBearing: bearing,
      targetBearingDesc: bearingDesc,
      markers,
      mapCenterLat: centerLat,
      mapCenterLng: centerLng
    })
  },

  // 视野缩放适应双方
  fitBothPositions() {
    const { myPos, partnerPos } = this.data
    if (!myPos || !partnerPos) return
    const mapCtx = wx.createMapContext('loveMap', this)
    mapCtx.includePoints({
      padding: [80, 60, 80, 60],
      points: [
        { latitude: myPos.latitude, longitude: myPos.longitude },
        { latitude: partnerPos.latitude, longitude: partnerPos.longitude }
      ]
    })
  },

  refreshLocation() {
    this.startLocationReporting()
    this.fetchData(true).then(() => {
      wx.showToast({ title: '已同步最新定位', icon: 'none' })
    })
  }
})
