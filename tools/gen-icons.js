// 生成 tabBar 图标 PNG（81x81, RGBA）—— 微信 tabBar 需要本地 PNG/JPG，不能用 SVG/emoji
// 用法：node tools/gen-icons.js
// 输出：miniprogram/images/tabbar/{home,earn,wish,stats}{,-active}.png
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const S = 81 // 图标边长（微信推荐 81x81）
const INACTIVE = [191, 166, 154, 255] // #BFA69A
const ACTIVE = [244, 143, 177, 255] // #F48FB1

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function encodePNG(w, h, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 画布 ----------
function makeCanvas(w, h) {
  const px = Buffer.alloc(w * h * 4)
  const c = {
    w, h, px,
    set(x, y, col) {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = (y * w + x) * 4
      px[i] = col[0]
      px[i + 1] = col[1]
      px[i + 2] = col[2]
      px[i + 3] = col[3]
    },
    fillRect(x0, y0, x1, y1, col) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c.set(x, y, col)
    },
    fillCircle(cx, cy, r, col) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const dx = x - cx
          const dy = y - cy
          if (dx * dx + dy * dy <= r * r) c.set(x, y, col)
        }
      }
    },
    clear(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c.set(x, y, [0, 0, 0, 0])
    },
  }
  return c
}

// ---------- 四个图标 ----------
function drawHome(col) {
  const c = makeCanvas(S, S)
  // 屋顶
  for (let y = 12; y <= 40; y++) {
    const halfW = Math.round(28 * ((y - 12) / 28))
    for (let x = 40 - halfW; x <= 40 + halfW; x++) c.set(x, y, col)
  }
  // 屋身
  c.fillRect(14, 40, 66, 66, col)
  // 门（镂空）
  c.clear(33, 50, 47, 66)
  return c
}

function drawEarn(col) {
  const c = makeCanvas(S, S)
  c.fillCircle(40, 40, 25, col)
  // + 号镂空
  c.clear(25, 37, 55, 43)
  c.clear(37, 25, 43, 55)
  return c
}

function drawPoints(col) {
  const c = makeCanvas(S, S)
  // 两枚叠起来的硬币
  c.fillCircle(33, 42, 13, col) // 左下硬币
  c.clear(27, 36, 39, 48) // + 形镂空
  c.clear(33, 36, 39, 48)
  c.fillCircle(47, 30, 13, col) // 右上硬币
  c.clear(41, 24, 53, 36)
  c.clear(47, 24, 53, 36)
  return c
}

function drawMoments(col) {
  const c = makeCanvas(S, S)
  // 相机机身
  c.fillRect(14, 28, 66, 58, col)
  // 镜头（镂空圆）
  c.clear(33, 36, 47, 50)
  // 取景框凸起
  c.fillRect(30, 18, 50, 28, col)
  // 闪光灯小圆
  c.fillCircle(60, 20, 4, col)
  return c
}

function drawStats(col) {
  const c = makeCanvas(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x - 40.5) / 30
      const ny = (y - 40.5) / 30
      const v = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * ny * ny * ny
      if (v < 0) c.set(x, y, col)
    }
  }
  return c
}

const ICONS = { home: drawHome, points: drawPoints, moments: drawMoments, stats: drawStats }
const OUT = path.join(__dirname, '..', 'miniprogram', 'images', 'tabbar')

fs.mkdirSync(OUT, { recursive: true })
for (const [name, fn] of Object.entries(ICONS)) {
  const normal = fn(INACTIVE)
  const active = fn(ACTIVE)
  fs.writeFileSync(path.join(OUT, name + '.png'), encodePNG(S, S, normal.px))
  fs.writeFileSync(path.join(OUT, name + '-active.png'), encodePNG(S, S, active.px))
  console.log('generated', name, name + '-active.png')
}
