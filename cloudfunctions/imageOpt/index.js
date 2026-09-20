// 云存储触发器：图片上传时自动压缩并转为 WebP，减小存储体积和流量消耗
//
// 部署方式：
//   1. 在微信开发者工具「云开发控制台 → 云函数」新建云函数 imageOpt
//   2. 将本文件作为 index.js 上传
//   3. 在「云开发控制台 → 存储」设置触发器：监听上传事件，触发此云函数
//
// 注意：云存储触发器是异步的，原始文件上传成功后即刻返回；
// 此函数会下载原图 → sharp 压缩 → 重新上传覆盖，用户看到的始终是最优版本。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 压缩配置
const MAX_WIDTH = 1920
const QUALITY = 80

exports.main = async (event) => {
  const { fileID } = event
  if (!fileID) return

  // 仅处理图片
  const ext = (fileID.split('.').pop() || '').toLowerCase()
  if (!['jpg', 'jpeg', 'png', 'bmp', 'gif'].includes(ext)) return

  try {
    // 下载原图
    const download = await cloud.downloadFile({ fileID })
    const buffer = download.fileContent

    // 用 sharp 压缩 + 转 WebP（云端 node_modules 需包含 sharp）
    // 如果 sharp 不可用则返回（说明未安装依赖，不影响主流程）
    let sharp
    try { sharp = require('sharp') } catch (e) { return }

    const compressed = await sharp(buffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer()

    // 重新上传覆盖（cloudPath 不变，fileID 不变，但内容已瘦身）
    const cloudPath = fileID.replace(/^cloud:\/\/[^/]+\//, '')
    await cloud.uploadFile({
      cloudPath,
      fileContent: compressed,
    })

    console.log(`[imageOpt] compressed ${fileID} (${buffer.length} → ${compressed.length} bytes)`)
  } catch (e) {
    console.error('[imageOpt] error', e)
  }
}
