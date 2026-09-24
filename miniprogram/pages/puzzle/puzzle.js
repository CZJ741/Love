// pages/puzzle/puzzle.js
const api = require('../../lib/api')
const { uploadImageWithCompress } = require('../../lib/image')

const GRID_SIZE = 9

// 辅助：构建九宫格进度格子（0-8），已完成的按累计数量填充
function buildGridCells(completedGroups) {
  const total = Number(completedGroups) || 0
  const cells = []
  for (let i = 0; i < GRID_SIZE; i++) {
    cells.push({
      index: i,
      filled: i < total,
    })
  }
  return cells
}

// 兼容性封装：部分基础库/安卓机型的 Canvas 2D 不支持 ctx.roundRect
// 统一走手写路径，避免 "ctx.roundRect is not a function" 报错
function drawRoundRect(ctx, x, y, w, h, radius) {
  let tl = 0, tr = 0, br = 0, bl = 0
  if (Array.isArray(radius)) {
    tl = radius[0] || 0
    tr = radius[1] || 0
    br = radius[2] || 0
    bl = radius[3] || 0
  } else {
    tl = tr = br = bl = radius || 0
  }

  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr > 0) ctx.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - br)
  if (br > 0) ctx.arc(x + w - br, y + h - br, br, 0, Math.PI / 2)
  ctx.lineTo(x + bl, y + h)
  if (bl > 0) ctx.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + tl)
  if (tl > 0) ctx.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

Page({
  data: {
    date: '',
    theme: '',
    status: 'pending', // 'pending' | 'completed'
    myUploaded: false,
    partnerUploaded: false,
    myPhotoUrl: '',
    partnerPhotoUrl: '',
    partnerNickname: 'TA',
    myNickname: '我',
    completedGroups: 0,
    remainGroups: GRID_SIZE,
    progressPercent: 0,
    gridCells: buildGridCells(0),
    gridSize: GRID_SIZE,
    reward: 15,
    canGeneratePoster: false,

    uploading: false,
    generating: false,

    // 九宫格海报弹窗
    showPosterModal: false,
    posterLoading: false,
    posterStatusText: '正在收集碎片画作...',
    posterTempPath: '',
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    try {
      wx.showNavigationBarLoading()
      const res = await api.call('puzzleGet')
      if (!res) {
        throw new Error('未获取到拼图数据')
      }
      const completedGroups = Number(res.completedGroups) || 0
      const gridSize = res.gridSize || GRID_SIZE

      this.setData({
        date: res.date || '',
        theme: res.theme || '',
        status: res.status || 'pending',
        myUploaded: Boolean(res.myUploaded),
        partnerUploaded: Boolean(res.partnerUploaded),
        myPhotoUrl: res.myPhotoUrl || '',
        partnerPhotoUrl: res.partnerPhotoUrl || '',
        partnerNickname: res.partnerNickname || 'TA',
        myNickname: res.myNickname || '我',
        completedGroups,
        remainGroups: Math.max(0, gridSize - completedGroups),
        progressPercent: Math.min(100, Math.round((completedGroups / gridSize) * 100)),
        gridCells: buildGridCells(completedGroups),
        gridSize,
        reward: res.reward || 15,
        canGeneratePoster: res.canGeneratePoster || false,
      })
    } catch (err) {
      console.error('[puzzle] loadData error:', err)
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideNavigationBarLoading()
    }
  },

  // 选择并上传我的视角照片
  chooseAndUpload() {
    const doChoose = () => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          const tempPath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
          if (!tempPath) return

          try {
            this.setData({ uploading: true })
            wx.showLoading({ title: '正在上传视角...' })

            // 1. 智能阶梯压缩至约 100KB 并上传至微信云存储
            const fileId = await uploadImageWithCompress(tempPath, 'reverse_photos')

            // 2. 调用云函数记录
            const upRes = await api.call('puzzleUpload', { fileId })

            wx.hideLoading()
            wx.showToast({
              title: upRes.completed ? '拼图达成！' : '视角上传成功',
              icon: 'success',
            })

            // 刷新数据
            await this.loadData()
          } catch (err) {
            wx.hideLoading()
            wx.showToast({ title: err.message || '上传失败', icon: 'none' })
          } finally {
            this.setData({ uploading: false })
          }
        },
      })
    }

    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: doChoose,
        fail: () => wx.showToast({ title: '需要权限才能拍摄或选图', icon: 'none' }),
      })
    } else {
      doChoose()
    }
  },

  // 预览我的视角大图
  previewMyPhoto() {
    if (this.data.myPhotoUrl) {
      wx.previewImage({
        current: this.data.myPhotoUrl,
        urls: [this.data.myPhotoUrl],
      })
    }
  },

  // 预览对方的视角大图
  previewPartnerPhoto() {
    if (this.data.partnerPhotoUrl) {
      wx.previewImage({
        current: this.data.partnerPhotoUrl,
        urls: [this.data.partnerPhotoUrl],
      })
    }
  },

  // 催促对方拍摄
  promptPartner() {
    wx.showModal({
      title: '💌 专属提示',
      content: `TA 还没有拍今天的主题“${this.data.theme}”，你可以点击下方“催TA快来拍下另一半”分享给TA哦！`,
      showCancel: false,
      confirmText: '知道啦',
    })
  },

  // 加载图片并返回本地临时对象（解决 Canvas 2D 跨域与图片载入问题）
  async downloadAndCreateImage(canvas, url) {
    const info = await new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: url,
        success: resolve,
        fail: reject,
      })
    })

    const img = canvas.createImage()
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = info.path
    })
    return { img, width: info.width, height: info.height }
  },

  // 将图片以 cover（居中填充裁切）方式绘制到目标区域
  drawImageCover(ctx, imgObj, dx, dy, dWidth, dHeight) {
    const { img, width: sWidth, height: sHeight } = imgObj
    const sRatio = sWidth / sHeight
    const dRatio = dWidth / dHeight

    let sx = 0, sy = 0, sw = sWidth, sh = sHeight
    if (sRatio > dRatio) {
      sw = sHeight * dRatio
      sx = (sWidth - sw) / 2
    } else {
      sh = sWidth / dRatio
      sy = (sHeight - sh) / 2
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dWidth, dHeight)
  },

  // 生成左右对比拼图并直接保存至系统相册
  async generateAndSaveStitched() {
    if (this.data.status !== 'completed' || !this.data.myPhotoUrl || !this.data.partnerPhotoUrl) {
      wx.showToast({ title: '双方都拍完后才能生成拼图哦', icon: 'none' })
      return
    }

    try {
      this.setData({ generating: true })
      wx.showLoading({ title: '正在合成左右拼图...' })

      const query = wx.createSelectorQuery()
      query.select('#stitchedCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          // 内层逻辑独立成函数，配合 Promise 让异常能被外层 try/catch 捕获
          this.renderStitchedCanvas(res)
        })
    } catch (err) {
      wx.hideLoading()
      this.setData({ generating: false })
      wx.showToast({ title: err.message || '生成拼图失败', icon: 'none' })
    }
  },

  async renderStitchedCanvas(res) {
    try {
      if (!res || !res[0] || !res[0].node) {
        wx.hideLoading()
        this.setData({ generating: false })
        wx.showToast({ title: '获取画板失败', icon: 'none' })
        return
      }

      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio || 2

      // 画布逻辑大小 750 * 1050
      const W = 750
      const H = 1050
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)

      // 1. 底衬（暖白拍立得质感）
      ctx.fillStyle = '#FAF7F5'
      ctx.fillRect(0, 0, W, H)

      // 2. 顶部主题标题胶囊
      ctx.fillStyle = '#FFFFFF'
      drawRoundRect(ctx, 30, 30, W - 60, 90, 20)
      ctx.fill()

      ctx.fillStyle = '#EC407A'
      ctx.font = 'bold 24px -apple-system, sans-serif'
      ctx.fillText('📷 今日奇怪视角挑战', 54, 70)

      ctx.fillStyle = '#3E2723'
      ctx.font = 'bold 28px -apple-system, sans-serif'
      ctx.fillText(`“${this.data.theme}”`, 54, 104)

      ctx.fillStyle = '#A1887F'
      ctx.font = '22px -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(this.data.date, W - 54, 86)
      ctx.textAlign = 'left'

      // 3. 下载并载入两张图片
      const [leftImg, rightImg] = await Promise.all([
        this.downloadAndCreateImage(canvas, this.data.myPhotoUrl),
        this.downloadAndCreateImage(canvas, this.data.partnerPhotoUrl),
      ])

      // 4. 照片主显示区域（高 680）
      const photoTop = 140
      const photoHeight = 680
      const halfWidth = (W - 60 - 10) / 2 // 340

      // 左侧：我的视角
      ctx.save()
      drawRoundRect(ctx, 30, photoTop, halfWidth, photoHeight, [16, 0, 0, 16])
      ctx.clip()
      this.drawImageCover(ctx, leftImg, 30, photoTop, halfWidth, photoHeight)

      // 左下角水印
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(30, photoTop + photoHeight - 44, halfWidth, 44)
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 20px -apple-system, sans-serif'
      ctx.fillText(`${this.data.myNickname} 的视角`, 44, photoTop + photoHeight - 16)
      ctx.restore()

      // 右侧：TA 的视角
      ctx.save()
      drawRoundRect(ctx, 30 + halfWidth + 10, photoTop, halfWidth, photoHeight, [0, 16, 16, 0])
      ctx.clip()
      this.drawImageCover(ctx, rightImg, 30 + halfWidth + 10, photoTop, halfWidth, photoHeight)

      // 右下角水印
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(30 + halfWidth + 10, photoTop + photoHeight - 44, halfWidth, 44)
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 20px -apple-system, sans-serif'
      ctx.fillText(`${this.data.partnerNickname} 的视角`, 30 + halfWidth + 24, photoTop + photoHeight - 16)
      ctx.restore()

      // 中间分割胶带线
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(30 + halfWidth, photoTop, 10, photoHeight)

      // 5. 底部文案与爱心印章
      const footerBoxTop = photoTop + photoHeight + 30
      ctx.fillStyle = '#FFFFFF'
      drawRoundRect(ctx, 30, footerBoxTop, W - 60, 150, 20)
      ctx.fill()

      ctx.textAlign = 'center'
      ctx.fillStyle = '#5D4037'
      ctx.font = '26px Georgia, serif'
      ctx.fillText('“ 即使不在一个地方，我们看的也是同一个世界。 ”', W / 2, footerBoxTop + 65)

      ctx.fillStyle = '#F48FB1'
      ctx.font = '22px -apple-system, sans-serif'
      ctx.fillText(`💕 已累计 ${this.data.completedGroups} 组拼图 · 双人合拍印证 💕`, W / 2, footerBoxTop + 110)
      ctx.textAlign = 'left'

      // 6. 导出图片并保存相册
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: W * dpr,
        height: H * dpr,
        destWidth: W * 2,
        destHeight: H * 2,
        success: (exportRes) => {
          wx.hideLoading()
          this.setData({ generating: false })
          this.saveImageToPhotos(exportRes.tempFilePath)
        },
        fail: (err) => {
          wx.hideLoading()
          this.setData({ generating: false })
          wx.showToast({ title: '拼图导出失败', icon: 'none' })
        },
      })
    } catch (err) {
      wx.hideLoading()
      this.setData({ generating: false })
      wx.showToast({ title: err.message || '生成拼图失败', icon: 'none' })
    }
  },

  // 打开九宫格大拼图弹窗并渲染
  openPosterModal() {
    this.setData({ showPosterModal: true, posterLoading: true, posterStatusText: '正在收集九组拼图...' })
    this.renderGridPoster()
  },

  closePosterModal() {
    this.setData({ showPosterModal: false })
  },

  // 渲染九宫格大拼图（3x3，共 9 组，每组左右两张）
  async renderGridPoster() {
    try {
      const posterData = await api.call('puzzleGetPosterData')
      const groups = posterData.groups || []
      if (groups.length < GRID_SIZE) {
        throw new Error(`已累计 ${groups.length} 组拼图，还需 ${GRID_SIZE - groups.length} 组才能生成九宫格`)
      }

      this.setData({ posterStatusText: '正在拼合九宫格...' })

      const query = wx.createSelectorQuery()
      query.select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          this.renderGridCanvas(res, posterData, groups)
        })
    } catch (err) {
      this.setData({ posterLoading: false })
      wx.showToast({ title: err.message || '九宫格生成失败', icon: 'none' })
    }
  },

  async renderGridCanvas(res, posterData, groups) {
    try {
      if (!res || !res[0] || !res[0].node) {
        this.setData({ posterLoading: false })
        return
      }

      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio || 2

      // 画布逻辑大小 660 * 900（3x3 九宫格）
      const W = 660
      const H = 900
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)

      // 1. 底衬：暖色相纸质感
      ctx.fillStyle = '#FAF6F2'
      ctx.fillRect(0, 0, W, H)

      // 2. 顶部标题
      ctx.textAlign = 'center'
      ctx.fillStyle = '#5D4037'
      ctx.font = 'bold 28px Georgia, serif'
      ctx.fillText('OUR NINE FRAGMENTS', W / 2, 52)

      ctx.fillStyle = '#A1887F'
      ctx.font = '18px -apple-system, sans-serif'
      ctx.fillText('九组拼图，拼成我们的同一世界', W / 2, 82)

      // 3. 加载九组切片（每组左右两张，共最多 18 张）
      const loadedGroups = []
      for (const group of groups) {
        const cells = []
        for (const cell of (group.cells || [])) {
          try {
            const loaded = await this.downloadAndCreateImage(canvas, cell.url)
            cells.push({ ...loaded, side: cell.side })
          } catch (e) {
            // 单张加载失败容错
          }
        }
        loadedGroups.push({ ...group, loadedCells: cells })
      }

      if (loadedGroups.every(g => g.loadedCells.length === 0)) {
        throw new Error('九宫格图片加载失败')
      }

      // 4. 九宫格布局：3 列 x 3 行
      const gridTop = 110
      const gridLeft = 30
      const gridWidth = W - 60
      const gridHeight = 700
      const gap = 10
      const cellW = (gridWidth - gap * 2) / 3
      const cellH = (gridHeight - gap * 2) / 3

      for (let i = 0; i < GRID_SIZE; i++) {
        const r = Math.floor(i / 3)
        const c = i % 3
        const x = gridLeft + c * (cellW + gap)
        const y = gridTop + r * (cellH + gap)

        const group = loadedGroups[i]

        // 卡片底衬（白色边框）
        ctx.fillStyle = '#FFFFFF'
        drawRoundRect(ctx, x, y, cellW, cellH, 10)
        ctx.fill()

        if (!group || group.loadedCells.length === 0) {
          // 空位占位
          ctx.fillStyle = '#EFE9E4'
          drawRoundRect(ctx, x + 5, y + 5, cellW - 10, cellH - 10, 8)
          ctx.fill()
          ctx.fillStyle = '#C7BDB5'
          ctx.font = '22px -apple-system, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('待', x + cellW / 2, y + cellH / 2 + 8)
          ctx.textAlign = 'left'
          continue
        }

        // 组内左右两张各占一半宽度
        const pad = 5
        const innerW = cellW - pad * 2
        const innerH = cellH - pad * 2 - 20
        const halfW = innerW / 2

        // 左图
        if (group.loadedCells[0]) {
          ctx.save()
          drawRoundRect(ctx, x + pad, y + pad, halfW, innerH, [6, 0, 0, 6])
          ctx.clip()
          this.drawImageCover(ctx, group.loadedCells[0], x + pad, y + pad, halfW, innerH)
          ctx.restore()
        }
        // 右图
        if (group.loadedCells[1]) {
          ctx.save()
          drawRoundRect(ctx, x + pad + halfW, y + pad, halfW, innerH, [0, 6, 6, 0])
          ctx.clip()
          this.drawImageCover(ctx, group.loadedCells[1], x + pad + halfW, y + pad, halfW, innerH)
          ctx.restore()
        }

        // 中缝白线
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(x + pad + halfW - 1, y + pad, 2, innerH)

        // 底部日期标签
        ctx.fillStyle = '#B0A6A0'
        ctx.font = '13px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(group.date.slice(5), x + cellW / 2, y + cellH - 8)
        ctx.textAlign = 'left'
      }

      // 5. 底部双方签名与日期区间
      ctx.textAlign = 'center'
      ctx.fillStyle = '#8D6E63'
      ctx.font = '17px -apple-system, sans-serif'
      ctx.fillText(
        `${posterData.user1} & ${posterData.user2} · 累计 ${groups.length} 组拼图`,
        W / 2,
        gridTop + gridHeight + 40
      )

      // 6. 导出临时图片
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: W * dpr,
        height: H * dpr,
        destWidth: W * 2,
        destHeight: H * 2,
        success: (expRes) => {
          this.setData({
            posterTempPath: expRes.tempFilePath,
            posterLoading: false,
          })
        },
        fail: () => {
          this.setData({ posterLoading: false })
        },
      })
    } catch (err) {
      this.setData({ posterLoading: false })
      wx.showToast({ title: err.message || '九宫格生成失败', icon: 'none' })
    }
  },

  // 保存海报至相册
  savePosterToAlbum() {
    if (!this.data.posterTempPath) {
      wx.showToast({ title: '海报还在绘制中，请稍候', icon: 'none' })
      return
    }
    this.saveImageToPhotos(this.data.posterTempPath)
  },

  // 通用保存图片至相册
  saveImageToPhotos(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许小程序保存图片到相册哦',
            confirmText: '去设置',
            success: (mRes) => {
              if (mRes.confirm) {
                wx.openSetting()
              }
            },
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: `📷 奇怪视角挑战：“${this.data.theme}”，快来拍下另一半！`,
      path: '/pages/puzzle/puzzle',
    }
  },
})