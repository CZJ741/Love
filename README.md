# 子&然 小窝 💕

两个人的积分小窝微信小程序 —— 基于微信云开发（云函数 + 云数据库 + 云存储）原生开发。

> **核心理念：让爱双向奔赴。** 给 TA 加分，你也会收到「好人卡奖励」；每天签到、完成惊喜任务都能攒分，再按比例自动存入「心愿小金库」，攒满了就一起去兑现。

---

## 一、功能总览

> 本项目仅服务你和你对象两人，已针对「两人小窝」做了极简优化：微信授权一键建档、加分/扣分无需密码、无房主概念。

| Tab | 页面 | 功能 |
| --- | --- | --- |
| 家 | `pages/home` | 我的积分（滚动数字）+ TA 的积分、今日心情系数、快捷加分（+5/+10/+20）、每日签到、今日惊喜盲盒、冷暴力预警 ☁️ |
| 赚 | `pages/earn` | 为 TA 加分 / 扣 TA 的分，选理由，**无需密码** |
| 花 | `pages/wish` | 心愿小金库进度条（攒钱模式）、创建心愿（目标金额 + 出资比例）、即刻兑换商城 |
| 我 | `pages/stats` | 睡前心情（1-5星）、积分明细、互动日历热力图、冷暴力预警 |
| 设置 | `pages/settings` | 修改微信头像/昵称、修改密码、复制房间号、退出小窝 |

### 登录方式（微信授权）

- 首次进入：**微信授权** —— 点头像即用「微信头像」（`chooseAvatar`，默认第一项就是你的微信头像），昵称用微信昵称（`input type="nickname"`）。
- 头像以云存储 fileID 持久化，无需在页面里选 emoji。
- 房间号 + 自己的密码（仅兑换心愿时确认用）。

### 5 个创新点

1. **动态汇率 · 爱的双向奔赴** —— 给 TA 加 10 分，TA +10，你还能获得 `10 × 30%` 的好人卡奖励（`points.js` 的 `addPoints`）。
2. **碎片盲盒 · 今日惊喜** —— 每天随机一个小任务（亲一下/倒杯水/夸我一句…），拍照上传云存储打卡，双方都完成各得 20 分（`blindbox.js`）。
3. **情绪气象台 · 动态积分倍率** —— 睡前双方记录 1-5 星心情；双方都 5 星 → 次日赚分翻倍 2x；任一 1 星 → 次日兑换打 5 折（`mood.js`）。
4. **心愿进度条 · 可视化攒钱** —— 创建心愿时不扣费，设定目标金额与每人出资比例；之后每次赚积分自动按比例划入小金库，攒满自动触发撒花特效（`economy.js` + `wish.js`）。
5. **冷暴力预警 · 数据可视化** —— 检测到连续 3 天无新增流水，首页顶部显示灰色乌云 ☁️，并支持发送订阅消息提醒（`cold.js`）。

---

## 二、目录结构

```
Love/
├── project.config.json          # 项目配置（appid 已填）
├── database.rules.json          # 数据库权限规则（导入用）
├── tools/
│   └── gen-icons.js             # 重新生成 tabBar 图标（node tools/gen-icons.js）
├── cloudfunctions/
│   └── api/                     # 唯一云函数（统一 action 入口）
│       ├── index.js             # 路由分发 + 自动建集合
│       ├── room.js              # 建档/创建加入小窝/改资料/改密码
│       ├── points.js            # 加分/扣分(无密码)/签到/心情
│       ├── blindbox.js          # 碎片盲盒
│       ├── wish.js              # 心愿 + 商城
│       ├── economy.js           # 心愿小金库划拨、积分入账
│       ├── mood.js              # 心情系数计算
│       ├── cold.js              # 订阅消息提醒
│       └── helpers.js           # 数据库句柄与工具
└── miniprogram/
    ├── app.js / app.json / app.wxss
    ├── images/tabbar/           # 4 个 Tab 图标 × 2（常态/选中）
    ├── lib/
    │   ├── api.js               # 云函数调用封装
    │   ├── realtime.js          # watch 实时数据层（全页面共享）
    │   ├── constants.js         # 理由/任务/商城常量
    │   └── config.js            # ★ 环境 ID 在这里填
    ├── utils/format.js
    ├── components/
    │   ├── rolling-number/      # 老虎机滚动数字
    │   └── heart-rain/          # 全屏爱心粒子特效
    └── pages/
        ├── index/               # 微信授权 + 创建/加入小窝
        ├── home/  earn/  wish/  stats/  settings/
```

---

## 三、部署步骤（重要）

1. **导入项目**：微信开发者工具 → 导入 `D:\Love`（AppID 已配置为 `wx5117a6fc440246df`，可用自己账号的云环境）。
2. **开通云开发**：点工具栏「云开发」→ 创建/选择环境，记下 **环境 ID**。
3. **填环境 ID**：打开 `miniprogram/lib/config.js`，把 `envId` 填成你的环境 ID（留空则用默认环境）。
4. **部署云函数（会自动建集合）**：右键 `cloudfunctions/api` →「上传并部署：云端安装依赖」。云函数首次被调用时会**自动创建** `users` / `transactions` / `wishes` / `dailies` 四个集合，无需手动建集合。
5. **设置权限（必做）**：在「云开发控制台 → 数据库」选中每个集合 →「权限设置」→ 选「自定义安全规则」，粘贴 `database.rules.json` 对应内容。
   - 核心：**只读、禁止前端写**。所有积分变动都只走云函数，前端没有任何 `update` 能力，防止作弊。
6. **编译运行**：点「编译」。首次打开在引导页「微信授权」选头像、填微信昵称 + 房间号 + 密码即自动建档。

> 验证部署：编译后若首页能显示「签到」「今日惊喜」且不报 `Function not found` 即成功。
> 提示：加分/扣分已**无需密码**（弹窗确认即可）；密码仅用于「兑换/领取/取消心愿」时确认。

### 订阅消息（可选）

1. 微信公众平台 → 订阅消息 → 申请一个模板（字段用 `thing1`、`time2`）。
2. 云函数 `api` → 环境变量添加 `COLD_TEMPLATE_ID` = 模板 ID（或填到 `miniprogram/lib/config.js` 的 `COLD_TEMPLATE_ID`）。
3. 首页点灰色乌云 → 同意订阅 → 即可向另一半发送「3天没发糖」提醒。

---

## 四、数据库 Schema 速查

- **users**：`openid`、`nickname`、`avatar`、`balance`(初始100)、`totalEarned`、`roomId`、`password`、`host`(是否房主)、`mood:{date,stars}`
- **transactions**：`roomId`、`fromUser/fromOpenid`、`toUser/toOpenid`、`amount`(正收负支)、`type`(reward/redeem/sign/punish/surprise)、`reason`、`createdAt`(服务器时间)
- **wishes**：`roomId`、`creator/creatorName`、`content`、`target`、`myRatio`、`savedByMe/savedByPartner/savedTotal`、`status`(pending/completed/canceled)、`createdAt`
- **dailies**（新增集合，用于盲盒）：`roomId`、`date`、`task`、`completers[]`、`proof{}`

---

## 五、云开发特性注意事项（开发约定）

以下约定已写进代码，改动时请遵守：

- **数据库权限**：`balance` 的加减只在云函数内用 `_.inc()` 原子操作完成（`economy.js`/`points.js`/`wish.js`）。前端**禁止**直接 `update`，数据库权限为「只读」。
- **时间处理**：流水 `createdAt` 一律用 `db.serverDate()`（服务器时间）；按「天」的业务（签到、心情、盲盒）统一用 UTC+8 的日期字符串（云函数 `cnDateStr()`），保证两台手机看到的“今天/昨天”一致。
- **实时同步**：`lib/realtime.js` 用 `db.collection().where({roomId}).watch()` 监听 users/transactions/wishes，两人面对面操作时双方手机自动刷新，无需下拉。页面在 `onLoad` 订阅、`onUnload` 取消。
- **初始化**：`app.js` 启动时 `wx.cloud.init` + 读取本地档案恢复监听；未建档时进入 `pages/index` 引导页。首次建档由云函数 `login` 完成：第一个进入该房间号的人成为房主（逻辑保留，UI 不展示），第二个人输入相同房间号即加入。
- **微信授权**：头像用 `chooseAvatar`（默认微信头像）+ `input type="nickname"`（微信昵称），头像上传云存储持久化，页面里用 `isCloudFile()` 区分「图片头像 / emoji 兜底」。
- **统一云函数**：所有业务收敛在 `cloudfunctions/api`，通过 `event.action` 分发，方便后期扩展（新增 action 只需在 `index.js` 的 `HANDLERS` 注册）。

---

## 六、常见问题

- **`Function not found`**：云函数没部署，或环境 ID 没填对。
- **`collection.get:fail -502005 database collection not exists`**：云函数没有自动建集合。请**重新部署** `cloudfunctions/api`（云端安装依赖），云函数首次调用会自动创建全部集合；若仍报错，手动在控制台建 `users`/`transactions`/`wishes`/`dailies` 四个集合即可。
- **「我们的窝」看不到对方 / 加分提示「TA 还没住进小窝」**：请依次排查
  1. **是否用了两个不同的微信账号？** 小程序按微信 openid 区分用户，同一个微信账号（含开发者工具里的同一测试号）只能建立一个档案。请在微信开发者工具用「多账号调试 / 切换测试账号」，或两台手机分别用各自微信登录。
  2. **数据库读权限是否设置？** 前端通过 `watch`/`get` 读取 `users` 集合需要集合权限允许「所有人可读」。请到「云开发控制台 → 数据库」给 4 个集合都选「自定义安全规则」，粘贴 `database.rules.json` 内容（`read: true, write: false`）。云函数创建的用户文档没有 `_openid`，如果权限是默认的「仅创建者可读写」，前端将读不到任何人。
  3. 代码已做兜底：`login` 云函数会返回房间成员，客户端用它「播种」本地用户表，即使读权限异常也能先看到对方并加分（加分本身在云函数内完成，不受前端读权限影响）。
- **页面空白/数据不刷新**：检查 4 个集合是否都建好、权限是否「可读」。
- **`document.update:fail -502001 ... Cannot create field 'date' in element {mood:null}`**：旧版云函数里用嵌套对象更新 `mood` 字段，而建档时 `mood` 初始为 `null`，无法在 null 里建子字段。已改用 `db.command.set()` 整体替换。**请重新部署 `cloudfunctions/api`** 即可。
- **密码校验失败**：加分/扣分**不需要密码**；兑换/领取/取消心愿输入**自己的**密码。
- **头像不显示**：微信头像上传后以 `cloud://` fileID 存储，需登录态正常；老数据是 emoji 会正常兜底显示。
- **想重置**：清空小程序本地缓存，重新进引导页输入同房间号即可恢复云端档案。
