// miniprogram/lib/image.js —— 图片智能阶梯压缩与云存储上传工具
// 目标：将照片体积控制在约 100KB 左右，节约 85%+ 云存储和流量费用，加快加载速度

const TARGET_SIZE_BYTE = 100 * 1024 // 100 KB
const MAX_ACCEPTABLE_BYTE = 130 * 1024 // 容差上限约 130 KB

/**
 * 获取本地文件大小 (Byte)
 */
function getFileSize(filePath) {
  return new Promise((resolve) => {
    if (!wx.getFileInfo) return resolve(0)
    wx.getFileInfo({
      filePath,
      success: (res) => resolve(res.size || 0),
      fail: () => resolve(0),
    })
  })
}

/**
 * 单次执行 wx.compressImage
 */
function compressOnce(src, quality) {
  return new Promise((resolve, reject) => {
    if (!wx.compressImage) return reject(new Error('wx.compressImage not supported'))
    wx.compressImage({
      src,
      quality,
      success: (res) => resolve(res.tempFilePath),
      fail: (err) => reject(err),
    })
  })
}

/**
 * 智能压缩图片至约 100KB
 * @param {string} filePath 本地临时路径
 * @returns {Promise<string>} 压缩后的临时路径（失败则安全回退原路径）
 */
async function compressImageTo100KB(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath
  if (filePath.startsWith('cloud://') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }

  try {
    let size = await getFileSize(filePath)
    // 若原图已经 <= 100KB，直接返回无需二次压缩
    if (size > 0 && size <= TARGET_SIZE_BYTE) {
      console.log(`[image] 原图较小 (${Math.round(size / 1024)}KB)，跳过压缩`)
      return filePath
    }

    console.log(`[image] 开始压缩原图: ${Math.round(size / 1024)}KB -> 目标约 100KB`)

    // 阶梯式递减质量：初始根据原图大小估算
    // 若原图极大(>2MB)，初始从 65 开始；普通图片从 75 开始
    const initialQualities = size > 2 * 1024 * 1024 ? [60, 45, 30] : [75, 55, 35]
    let currentPath = filePath
    let bestPath = filePath

    for (const q of initialQualities) {
      try {
        const nextPath = await compressOnce(currentPath, q)
        const nextSize = await getFileSize(nextPath)
        console.log(`[image] quality=${q} 压缩后大小: ${Math.round(nextSize / 1024)}KB`)

        bestPath = nextPath
        currentPath = nextPath

        // 已经压到目标范围（<= 130KB），提前结束
        if (nextSize > 0 && nextSize <= MAX_ACCEPTABLE_BYTE) {
          break
        }
      } catch (err) {
        console.warn(`[image] quality=${q} 压缩失败:`, err)
        break
      }
    }

    return bestPath
  } catch (e) {
    console.error('[image] compressImageTo100KB 出现异常，回退原图:', e)
    return filePath
  }
}

/**
 * 压缩并统一上传至微信云存储
 * @param {string} filePath 本地文件路径
 * @param {string} folder 云存储文件夹，如 'moments' 或 'reverse_photos'
 * @returns {Promise<string>} 云存储 fileID
 */
async function uploadImageWithCompress(filePath, folder = 'uploads') {
  if (!filePath) throw new Error('filePath 不能为空')
  if (filePath.startsWith('cloud://')) return filePath // 已是云文件直接返回

  // 1. 深度阶梯压缩至 100KB 左右
  const compressedPath = await compressImageTo100KB(filePath)

  // 2. 提取文件扩展名（默认 .jpg）
  const extMatch = compressedPath.match(/\.[^.]+$/)
  const ext = extMatch ? extMatch[0] : '.jpg'
  const cloudPath = `${folder}/${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`

  // 3. 上传微信云存储
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath: compressedPath,
  })

  return res.fileID
}

module.exports = {
  getFileSize,
  compressImageTo100KB,
  uploadImageWithCompress,
}
