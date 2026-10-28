// 恋爱清单 / 专属心愿清单 前端页面交互逻辑
const api = require('../../lib/api')
const { uploadImageWithCompress } = require('../../lib/image')

// 绘制圆角矩形帮助函数
function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arcTo(x + width, y, x + width, y + radius, radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
  ctx.lineTo(x + radius, y + height)
  ctx.arcTo(x, y + height, x, y + height - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

// 图片居中 Cover 裁切
function drawImageCover(ctx, img, dx, dy, dWidth, dHeight) {
  const imgW = img.width || 1
  const imgH = img.height || 1
  const scale = Math.max(dWidth / imgW, dHeight / imgH)
  const sw = dWidth / scale
  const sh = dHeight / scale
  const sx = (imgW - sw) / 2
  const sy = (imgH - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dWidth, dHeight)
}

Page({
  data: {
    loading: true,
    total: 0,
    doneCount: 0,
    list: [],

    // 打卡弹窗
    showCheckModal: false,
    activeItem: null,
    tempUploadImages: [],
    checkRemark: '',
    submitting: false,

    // 添加待办弹窗
    showCustomModal: false,
    customTitle: '',

    // 海报生成
    showPosterModal: false,
    posterTempPath: ''
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    if (!this.data.loading) {
      this.loadData(false)
    }
  },

  async loadData(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await api.call('loveList_get', {})
      this.setData({
        loading: false,
        total: res.total || 0,
        doneCount: res.doneCount || 0,
        list: res.list || []
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载清单失败', icon: 'none' })
    }
  },

  // 点击打勾/取消打勾
  toggleCheck(e) {
    const item = e.currentTarget.dataset.item
    if (item.done) {
      // 已经完成的，提示是否重置取消
      wx.showModal({
        title: '取消完成',
        content: `确定要将「${item.title}」标记为未完成吗？`,
        confirmColor: '#FF5252',
        success: async (res) => {
          if (res.confirm) {
            try {
              await api.call('loveList_check', { id: item._id, done: false })
              wx.showToast({ title: '已重置', icon: 'success' })
              this.loadData(false)
            } catch (err) {
              wx.showToast({ title: err.message || '重置失败', icon: 'none' })
            }
          }
        }
      })
    } else {
      // 准备打卡：打开打卡上传凭证弹窗
      this.setData({
        showCheckModal: true,
        activeItem: item,
        tempUploadImages: [],
        checkRemark: ''
      })
      wx.vibrateShort({ type: 'light' })
    }
  },

  // 删除事项
  deleteItem(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '删除待办',
      content: `确定要删除「${item.title}」吗？`,
      confirmColor: '#FF5252',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.call('loveList_delete', { id: item._id })
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadData(false)
          } catch (err) {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  closeCheckModal() {
    this.setData({ showCheckModal: false })
  },

  preventBubble() {},

  onRemarkInput(e) {
    this.setData({ checkRemark: e.detail.value })
  },

  // 选择凭证照片并执行本地压缩与云存储上传
  async chooseProofImage() {
    try {
      const media = await wx.chooseMedia({
        count: 3 - this.data.tempUploadImages.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      if (!media.tempFiles || !media.tempFiles.length) return

      wx.showLoading({ title: '压缩上传中...' })
      const uploadedFileIds = []

      for (const f of media.tempFiles) {
        const fileID = await uploadImageWithCompress(f.tempFilePath, 'lovelist')
        uploadedFileIds.push(fileID)
      }

      wx.hideLoading()
      this.setData({
        tempUploadImages: [...this.data.tempUploadImages, ...uploadedFileIds]
      })
      wx.showToast({ title: '照片已上传', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      if (err.errMsg && !err.errMsg.includes('cancel')) {
        wx.showToast({ title: err.message || '上传照片失败', icon: 'none' })
      }
    }
  },

  removeUploadImage(e) {
    const idx = e.currentTarget.dataset.idx
    const list = [...this.data.tempUploadImages]
    list.splice(idx, 1)
    this.setData({ tempUploadImages: list })
  },

  // 确认打卡完成
  async confirmCheckDone() {
    if (!this.data.activeItem) return
    this.setData({ submitting: true })
    try {
      await api.call('loveList_check', {
        id: this.data.activeItem._id,
        done: true,
        remark: this.data.checkRemark,
        images: this.data.tempUploadImages
      })
      wx.vibrateShort({ type: 'medium' })
      wx.showToast({ title: '恭喜达成！💕', icon: 'success' })
      this.setData({ showCheckModal: false, submitting: false })
      this.loadData(false)
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '打卡失败', icon: 'none' })
    }
  },

  // 添加待办弹窗
  openAddCustomModal() {
    this.setData({
      showCustomModal: true,
      customTitle: ''
    })
  },

  closeCustomModal() {
    this.setData({ showCustomModal: false })
  },

  onCustomTitleInput(e) {
    this.setData({ customTitle: e.detail.value })
  },

  async submitCustomItem() {
    const { customTitle } = this.data
    if (!customTitle.trim()) {
      wx.showToast({ title: '请输入待办内容', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.call('loveList_add', {
        title: customTitle
      })
      wx.showToast({ title: '已添加', icon: 'success' })
      this.setData({ showCustomModal: false, submitting: false })
      this.loadData(false)
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    }
  },

  previewProofImg(e) {
    const { url, urls } = e.currentTarget.dataset
    wx.previewImage({ current: url, urls: urls || [url] })
  },

  // 生成 Canvas 2D 成就海报
  async generatePoster(e) {
    const item = e.currentTarget.dataset.item
    const idx = e.currentTarget.dataset.idx || 1
    if (!item) return

    wx.showLoading({ title: '正在绘制成就海报...' })
    const query = wx.createSelectorQuery()
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res || !res[0] || !res[0].node) {
          wx.hideLoading()
          wx.showToast({ title: '获取画板失败', icon: 'none' })
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2

        const W = 750
        const H = 1050
        canvas.width = W * dpr
        canvas.height = H * dpr
        ctx.scale(dpr, dpr)

        // 1. 暖粉渐变高级拍立得底衬
        const bgGrad = ctx.createLinearGradient(0, 0, W, H)
        bgGrad.addColorStop(0, '#FFF5F7')
        bgGrad.addColorStop(1, '#FFEBEF')
        ctx.fillStyle = bgGrad
        ctx.fillRect(0, 0, W, H)

        // 2. 主卡片框（微投影白色拍立得纸）
        ctx.fillStyle = '#FFFFFF'
        drawRoundRect(ctx, 40, 50, W - 80, H - 100, 32)
        ctx.fill()

        // 3. 顶部勋章与标题
        ctx.fillStyle = '#EC407A'
        ctx.font = 'bold 24px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('✨ 恋 爱 清 单 甜 蜜 达 成 ✨', W / 2, 120)

        ctx.fillStyle = '#3E2723'
        ctx.font = 'bold 36px -apple-system, sans-serif'
        ctx.fillText(`“ ${item.title} ”`, W / 2, 210)

        // 4. 绘制照片凭证 (若有)
        const photoY = 270
        const photoH = 480
        const photoW = W - 140

        if (item.imageUrls && item.imageUrls[0]) {
          try {
            const imgInfo = await new Promise((resolve, reject) => {
              wx.getImageInfo({
                src: item.imageUrls[0],
                success: resolve,
                fail: reject
              })
            })
            const imgObj = canvas.createImage()
            await new Promise((resolve, reject) => {
              imgObj.onload = resolve
              imgObj.onerror = reject
              imgObj.src = imgInfo.path
            })

            ctx.save()
            drawRoundRect(ctx, 70, photoY, photoW, photoH, 24)
            ctx.clip()
            drawImageCover(ctx, imgObj, 70, photoY, photoW, photoH)
            ctx.restore()
          } catch (e) {
            console.error('load image error', e)
          }
        } else {
          // 无图时的浪漫手绘占位框
          ctx.fillStyle = '#FFF9FA'
          drawRoundRect(ctx, 70, photoY, photoW, photoH, 24)
          ctx.fill()

          ctx.fillStyle = '#F48FB1'
          ctx.font = 'bold 72px sans-serif'
          ctx.fillText('💕', W / 2, photoY + 230)
          ctx.font = '22px sans-serif'
          ctx.fillStyle = '#B39B8A'
          ctx.fillText('美好回忆 · 共同珍藏', W / 2, photoY + 280)
        }

        // 6. 心得寄语与时间印章
        const remarkText = item.remark ? `“${item.remark}”` : '在这个特别的日子里，我们又一起完成了一件浪漫小事。'
        ctx.fillStyle = '#795548'
        ctx.font = 'italic 24px -apple-system, sans-serif'
        ctx.fillText(remarkText, W / 2, 810)

        // 底部日期与情侣小窝签名
        ctx.fillStyle = '#B39B8A'
        ctx.font = '22px -apple-system, sans-serif'
        ctx.fillText(`达成时间：${item.doneAt || '今天'}`, W / 2, 880)

        ctx.fillStyle = '#F48FB1'
        ctx.font = 'bold 24px -apple-system, sans-serif'
        ctx.fillText('—— 子 & 然 小 窝 独 家 见 证 ——', W / 2, 925)

        // 导出海报
        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width: W * dpr,
          height: H * dpr,
          destWidth: W * 2,
          destHeight: H * 2,
          success: (resPath) => {
            wx.hideLoading()
            this.setData({
              showPosterModal: true,
              posterTempPath: resPath.tempFilePath
            })
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: '导出海报失败', icon: 'none' })
          }
        })
      })
  },

  // 保存海报至相册
  savePosterToAlbum() {
    if (!this.data.posterTempPath) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterTempPath,
      success: () => {
        wx.showToast({ title: '已保存至手机相册', icon: 'success' })
        this.setData({ showPosterModal: false })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '授权相册权限',
            content: '需要您的相册授权才能保存浪漫成就海报哦',
            confirmColor: '#F48FB1',
            success: (m) => {
              if (m.confirm) wx.openSetting()
            }
          })
        }
      }
    })
  },

  closePosterModal() {
    this.setData({ showPosterModal: false })
  }
})
