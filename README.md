# 美人挥杆 · 3D 高尔夫（浏览器游戏）

**在线试玩：<https://gaooerfu-game.pages.dev>** · 源码：[dmllpj46-ship-it/gaooerfu-game](https://github.com/dmllpj46-ship-it/gaooerfu-game)

浏览器里直接开打的高尔夫游戏：3D 球场、真实弹道物理、一位女性球手站在发球台上。在画面里左右拖动改方向（不出杆），向下拖动蓄力、松手出杆 —— 看小白球带着后旋划过球道，落上果岭再推入洞中。

- 纯前端，无后端、无登录，静态托管即可发布（Cloudflare Pages）
- three.js 渲染（PBR + ACES + 泛光）+ 自研球体物理（重力 / 空气阻力 / 后旋升力 / 风）
- 3 洞完整比赛：发球台 → 球道 → 沙坑/水塘 → 果岭 → 洞杯，带逐洞与整轮结算
- **零二进制资产**：地形、材质、草、树、天空全部运行时程序化生成

> **当前状态：MVP 可玩，已上线。** 三洞比赛、挥杆、物理、计分、结算、暂停、移动端触摸都已跑通（详见 [`PLAN.md`](PLAN.md) §11 的实测记录）。角色是程序化几何体（卡通比例），要换 GLTF 需先确定一个 CC0/CC-BY 且自带挥杆动画的来源。

---

## 文档

| 文件 | 内容 |
| --- | --- |
| [`PLAN.md`](PLAN.md) | 玩法、物理模型、架构、里程碑与实测状态 —— **改需求先改它** |
| [`AGENTS.md`](AGENTS.md) | 给 AI/人类协作者的编码规则、命令与不变量 |
| `README.md` | 就是本文件：怎么跑、怎么玩、目录在哪 |

---

## 快速开始

```bash
npm install          # 安装依赖
npm run dev          # 本地开发，默认 http://localhost:5173
npm run typecheck    # tsc --noEmit，要求 0 错误
npm test             # vitest：物理落点、确定性、计分
npm run build        # 静态产物输出到 dist/
npm run preview      # 预览 dist/ 产物
```

调试模式：URL 加 `?debug=1`，左下角芯片会额外显示 draw call 与三角面数，并在 `window.__game` 暴露游戏实例。

---

## 操作

| 操作 | 桌面 | 移动端 |
| --- | --- | --- |
| 蓄力挥杆 | 按住并**向下**拖动 30px 以上 → 松手 | 同左（触摸） |
| 调整方向 | 左右拖动（**不出杆**，松手只是把方向定下来） | 同左 |
| 微调方向 | 按住 `Shift` 拖动（灵敏度 1/4），或 `←` / `→` 每次 0.4° | 小幅度左右拖动 |
| 重新对正球洞 | 原地单击（横移 < 10px） | 原地轻点 |
| 切换球杆 | `1`–`4` 或点击底部按钮 | 点击底部按钮 |
| 推进遮罩 | `Enter` / 空格 | 点击按钮 |
| 暂停 | `Esc` / `P` | 右上角（移动端走键盘外的遮罩入口前先暂停） |

地面上有一条贴地的瞄准线指示当前方向，HUD 会显示相对"球→洞"的偏差角（`正对球洞` / `偏右 4.2°`）。
拖拽长度换算成力度，松手时角色挥杆，杆头到球的一瞬间才把速度交给物理。

---

## 目录结构

```
src/
  main.ts                 入口：启动 Game，失败时提示
  core/
    Game.ts               主循环、回合状态机、固定步长物理驱动
    Input.ts              指针拖拽 → 力度/方向，键盘快捷键
    Settings.ts           ?debug、像素比上限、后期开关
  world/
    Terrain.ts            2m 高度场 + 面层掩码（物理与顶点色同源）
    Course.ts             按数据装配球场：地形/水/旗杆/洞杯
    Grass.ts              1600 个实例的单 draw call 草丛，按洞重撒
    Sky.ts                渐变天穹 shader + 由它生成的 PMREM 环境贴图 + 太阳光
    Surfaces.ts           各面层的弹性/滚动摩擦/颜色
    courses/course01.ts   三洞关卡数据（par、tee、cup、沙坑、水塘、风）
  game/
    BallPhysics.ts        纯函数球体物理（阻力 + 升力 + 反弹 + 滚动 + 进洞）
    physics.config.ts     所有手感常量
    clubs.ts              4 支球杆与力度→初速映射
    Ball.ts               球、弹道拖尾、落点标记、接触阴影
    Round.ts              洞位推进与杆数记录
    Scoring.ts            par/birdie/… 命名与总成绩（纯函数）
  char/
    Golfer.ts             程序化女性球手 + 球杆挂点
    SwingAnimator.ts      上杆/下杆/收杆时序，impact 只触发一次
  render/
    Renderer.ts           渲染器 + 泛光后期（移动端自动关闭）
    CameraRig.ts          6 态阻尼机位（title/address/flight/landing/putt/hole）
    ImpactParticles.ts    击球/落地的尘粒
  ui/
    HUD.ts                洞况、力度条、杆种选择、提示
    Screens.ts            标题/进洞/结算/暂停遮罩
    style.css
  audio/Sfx.ts            WebAudio 合成的挥杆/击球/落水/进洞音效
tests/                    物理校准与计分单测
```

---

## 调参

| 想改什么 | 改哪里 |
| --- | --- |
| 弹道手感（重力、阻力、升力、摩擦） | `src/game/physics.config.ts` |
| 球杆距离 / 起飞角 / 后旋 | `src/game/clubs.ts`，改完跑 `npm test` 看落点 |
| 球场布局、par、沙坑、水塘、风 | `src/world/courses/course01.ts` |
| 各面层的速度特性 | `src/world/Surfaces.ts` |

物理测试会打印每支杆的 carry / total，改完数值先看这两个数字有没有跑偏。

---

## 尚未实现（v1.1 候选）

- 正式 GLTF 角色与动作库（当前用程序化几何体 + 参数化挥杆，`Golfer` 接口已隔离好）
- 背景音乐、练习场模式、坡度/风向辅助线、18 洞球场
- 移动端只有"关泛光"这一档画质，尚未做草量/阴影/水面的分级降档

---

## 资产与许可

目前**没有任何第三方美术或音频素材**：地形、草、水、球杆、角色全部由几何体程序化生成，音效由 WebAudio 实时合成。后续接入外部资产时必须在此登记来源与许可证（CC0 / CC-BY 优先）。

---

## 说明

游戏内的女性角色为成年职业球手形象，走运动清爽风格（polo、短裙、球帽、手套、马尾），镜头服务于看清落点。请勿改成擦边化版本，约束见 `AGENTS.md` §7。
