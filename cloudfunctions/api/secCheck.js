// cloudfunctions/api/secCheck.js —— 微信小程序 UGC 内容安全审核模块 (msgSecCheck / imgSecCheck)
const { cloud } = require('./helpers')

class SecCheckError extends Error {
  constructor(message = '内容包含违规或敏感信息，请修改后重试', code = 87014) {
    super(message)
    this.name = 'SecCheckError'
    this.code = code
  }
}

/**
 * 判断是否为明确的合规违规错误
 */
function isViolationError(err) {
  if (!err) return false
  if (err instanceof SecCheckError || err.code === 87014 || err.errCode === 87014) {
    return true
  }
  const msg = String(err.errMsg || err.message || '')
  if (msg.includes('risky') || msg.includes('87014') || msg.includes('违规')) {
    return true
  }
  return false
}

/**
 * 文本内容安全检测 (msgSecCheck)
 * @param {string} content 待检测文本
 * @param {Object} [options] 额外参数
 * @returns {Promise<boolean>}
 */
async function checkText(content, options = {}) {
  if (!content || typeof content !== 'string') return true
  const trimmed = content.trim()
  if (!trimmed) return true

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: trimmed,
      ...(options.openid ? { openid: options.openid } : {}),
      ...(options.scene ? { scene: options.scene } : {}),
    })

    if (res && res.result && res.result.suggest === 'risky') {
      throw new SecCheckError('内容包含违规或敏感信息，请修改后重试', 87014)
    }

    if (res && res.errCode === 87014) {
      throw new SecCheckError('内容包含违规或敏感信息，请修改后重试', 87014)
    }

    return true
  } catch (err) {
    if (isViolationError(err)) {
      throw (err instanceof SecCheckError) ? err : new SecCheckError('内容包含违规或敏感信息，请修改后重试', 87014)
    }
    // 非违规类错误（本地开发调试环境无 OpenAPI 权限、网络超时等），记录告警并放行，避免阻断正常使用
    console.warn('[secCheck] checkText non-fatal error, fallback pass:', err.errCode, err.errMsg || err.message)
    return true
  }
}

/**
 * 单图安全检测 (imgSecCheck)
 * @param {string} fileId 云存储 fileID (cloud://...)
 * @returns {Promise<boolean>}
 */
async function checkSingleImage(fileId) {
  if (!fileId || typeof fileId !== 'string' || !fileId.startsWith('cloud://')) {
    return true
  }

  let downloadRes
  try {
    downloadRes = await cloud.downloadFile({ fileID: fileId })
  } catch (downloadErr) {
    console.warn('[secCheck] downloadFile failed, fallback pass:', fileId, downloadErr.message || downloadErr)
    return true
  }

  const buffer = downloadRes.fileContent
  if (!buffer || buffer.length === 0) return true

  let contentType = 'image/jpeg'
  const lower = fileId.toLowerCase()
  if (lower.endsWith('.png')) contentType = 'image/png'
  else if (lower.endsWith('.gif')) contentType = 'image/gif'
  else if (lower.endsWith('.webp')) contentType = 'image/webp'

  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType,
        value: buffer,
      },
    })

    if (res && res.result && res.result.suggest === 'risky') {
      throw new SecCheckError('上传的图片包含违规或不适宜内容，请更换后重试', 87014)
    }

    if (res && res.errCode === 87014) {
      throw new SecCheckError('上传的图片包含违规或不适宜内容，请更换后重试', 87014)
    }

    return true
  } catch (err) {
    if (isViolationError(err)) {
      throw (err instanceof SecCheckError) ? err : new SecCheckError('上传的图片包含违规或不适宜内容，请更换后重试', 87014)
    }
    console.warn('[secCheck] imgSecCheck non-fatal error, fallback pass:', err.errCode, err.errMsg || err.message)
    return true
  }
}

/**
 * 批量图片安全检测 (支持并发检测与自动清理违规文件)
 * @param {string[]} fileList 云存储 fileID 列表
 * @returns {Promise<boolean>}
 */
async function checkImages(fileList) {
  if (!Array.isArray(fileList) || fileList.length === 0) return true

  const cloudFiles = fileList.filter(f => typeof f === 'string' && f.startsWith('cloud://'))
  if (cloudFiles.length === 0) return true

  try {
    await Promise.all(cloudFiles.map(fileId => checkSingleImage(fileId)))
    return true
  } catch (err) {
    if (isViolationError(err)) {
      // 违规图片拦截：物理删除已上传的本批次云存储文件，防止垃圾脏数据滞留
      try {
        await cloud.deleteFile({ fileList: cloudFiles })
        console.warn('[secCheck] Pruned flagged cloud files from storage:', cloudFiles)
      } catch (cleanErr) {
        console.error('[secCheck] Failed to prune flagged cloud files:', cleanErr)
      }
    }
    throw err
  }
}

module.exports = {
  SecCheckError,
  checkText,
  checkSingleImage,
  checkImages,
}
