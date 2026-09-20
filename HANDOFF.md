# HANDOFF.md

## 1. 项目一句话简介
基于微信小程序原生框架与微信云开发的双人情侣专属互动空间（“子&然 小窝”），集成积分奖惩激励、约会盲盒、反向合影拼图、食物转盘及恋爱时光轴等功能。

## 2. 当前进度
- **正在做的任务**：根据“纯成长感”设计方案，全面重构双人共养虚拟宠物系统：
  - **四大形态阶段**：蛋 (egg) → 幼崽 (baby) → 成长期 (youth) → 完全体 (adult)，各阶段具备独立外观形态与成长节奏（前期快、后期慢）；
  - **经验与共享经验池**：双方共享经验池，当日总经验上限，不设个人贡献攀比；
  - **健康度总指标**：引入健康度（health），受饱食、心情、清洁、疲劳影响；健康度 < 60% 时外观呈现虚弱病态（贴创口贴、打喷嚏）；健康度 < 80% 无法触发进化；支持单独看病治疗恢复健康；
  - **共同确认进化仪式**：阶段经验满 + 健康度 ≥ 80% 时可由一方发起进化，另一方确认后完成破茧蜕变，进化成功后全状态满格奖励；
  - **结合已有积分系统**：新增【萌宠积分商店】（肉干、罐头、香波沐浴露、飞盘、特效药、心愿蛋糕），扣除双方各自积分购买并照料宠物。
  - 具体涉及文件/函数：
    - `cloudfunctions/api/pet.js`：重构阶段机制（`STAGES`）、每日经验上限（`dailyExpLimit`）、健康度联动算法（`calcDecayedStats`）、商城购买（`petBuyItem`）、发起进化（`petRequestEvolve`）与共同确认（`petConfirmEvolve`）。
    - `cloudfunctions/api/index.js`：注册 `petBuyItem`、`petRequestEvolve`、`petConfirmEvolve` 等云函数 action。
    - `miniprogram/components/live2d-pet/`：支持蛋形态（微光光晕、呼吸、破壳裂纹）与幼崽/成长期/完全体差异化装饰及生病病态（🩹 创口贴、💧 冷汗）。
    - `miniprogram/pages/pet/`：全面重构专属宠物页面，呈现进化仪式卡片、成长进度条、健康度与三维数值、专属互动及萌宠积分商店。
- **完成到哪一步**：四大形态进化体系、健康度总指标与积分商城已全部开发并测试完成。
- **下一步该做什么**：微信开发者工具中右键上传并部署 `cloudfunctions/api`，编译体验蛋阶段互动、积攒经验与积分商城购买。
- **已知阻塞**：无。

## 3. 项目结构树
```text
.
├── cloudfunctions/             # 微信云开发云函数端
│   └── api/                    # 统一单入口云函数（包含所有业务操作分发与数据库防刷写）
├── miniprogram/                # 微信小程序前端源码
│   ├── components/             # 公共自定义组件（如 heart-rain 爱心雨）
│   ├── images/                 # 图标与静态图片资源
│   ├── lib/                    # 全局基础库与配置（api客户端、数据监听realtime、常量等）
│   ├── pages/                  # 各功能页面目录
│   └── utils/                  # 格式化与工具函数
├── project.config.json         # 微信开发者工具项目配置
└── HANDOFF.md                  # AI 会话交接文档
```

## 4. 主要功能模块速查表
| 模块 | 位置 | 职责 | 关键函数 |
| :--- | :--- | :--- | :--- |
| **云函数统一网关** | `cloudfunctions/api/index.js` | 验证身份上下文、分发业务 action、保证积分事务防作弊 | `main(event, context)` |
| **实时数据同步层** | `miniprogram/lib/realtime.js` | 监听房间用户/流水变动、双人面对面状态同步 | `init(roomId, myOpenid)`, `getMe()`, `getPartner()`, `on()`, `off()` |
| **家（首页）** | `miniprogram/pages/home/` | 呈现双人信息、陪伴天数、快捷发糖赞美、功能入口网格、食物大转盘 | `refresh()`, `goPoints()`, `goDatebox()`, `goPuzzle()`, `openFoodWheel()` |
| **任务与积分** | `miniprogram/pages/points/` | 双方加分/扣分打卡、自定义奖惩原因与分值提交 | `onReason()`, `submit()`, `refresh()` |
| **约会盲盒** | `miniprogram/pages/datebox/` | 双人盲盒偏好勾选与约会计划随机抽取 | `draw()`, `toggleTag()` |
| **反向合影拼图** | `miniprogram/pages/puzzle/` | 每日双人奇怪视角拍摄与九宫格默契拼合 | `takePhoto()`, `generatePuzzle()`, `fetchPuzzleStatus()` |
| **恋爱时光轴** | `miniprogram/pages/moments/` | 私密生活点滴记录、照片及留言上传展示 | `loadMoments()`, `publish()` |
| **个人与统计** | `miniprogram/pages/stats/` | 互动热力图、纪念日及个人资料配置 | `saveProfile()`, `loadStats()` |

## 5. 关键约定
- **包管理**：
  - 云函数依赖位于 `cloudfunctions/api/`，采用 npm 管理（依赖 `wx-server-sdk`）。
  - 小程序端原生开发，无额外构建依赖。
- **架构约定**：
  - 小程序前端禁止直写/直更云数据库中的敏感字段（如 balance、status），所有积分加减必须走 `api.call('actionName', params)` 由云端校验完成。
- **命名规范**：
  - 页面命名采用全小写短横线或单动词（如 `tx-history`、`datebox`）。
  - CSS 布局尺寸统一使用 `rpx`。
- **测试命令**：
  - 待补充（当前依赖微信开发者工具调试器与真机预览）。

## 6. 最近改动记录
- **2026-09-20**：在时间轴（moments）页面为帖子新增双人评论功能。
  - 云函数：在 `cloudfunctions/api/moments.js` 与 `index.js` 新增 `addComment` 与 `deleteComment`，支持帖子内嵌 `comments` 数组原子追加/删除与权限校验（评论者本人或帖主可删）。
  - 小程序前端：在 `miniprogram/pages/moments/` 实现了时间轴卡片评论徽标与最新留言预览，并在帖子详情弹窗中新增“甜蜜互动”评论列表（兼容 Emoji/图片头像及友好相对时间）及底部发送评论输入栏。
- **2026-09-18**：按需求将【任务】恢复至底部导航栏（家、任务、时间轴、我），同时保留【家】页面下方一行三个的功能网格及“任务打卡”入口（点击执行 `switchTab`）。
- **2026-09-18**：优化家页面“任务打卡”图标背景色为淡紫渐变（`#E1BEE7` ~ `#BA68C8`），提升与黄色星星图标的对比度。
- **2026-09-18**：在“家”页面下方新增“任务打卡”入口，并将功能入口重构成一行三个的 `.feature-grid` 网格（任务打卡、约会盲盒、合影挑战、今天吃啥）。
- **2026-09-07**：修复 `puzzle` 拼图页面底部按钮文字显示不全与截断问题，规范小程序按钮 `<button>` 居中与文字截断规范。
- **2026-09-06**：新增“今天吃什么”食物转盘功能及自定义菜单编辑弹窗。
