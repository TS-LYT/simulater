# 水声 Three.js 页面接手说明（给后续模型）

仓库：`/home/lyt/Code/three-js-demo`  
分支：`main`  
当前提交：`1ae5f23` `feat: 拆分节点管理、详情面板和通信仿真控制台`  
对照需求：节点管理 / Inspector / 通信仿真控制台职责拆分，不改声学与传播算法。

后续模型进场后：先读本文，再读代码。不要重写项目，不要换 Three.js，不要改 `src/acoustics.js` / `src/wave.js` 里的计算公式。

---

## 1. 项目是什么

Vite + Three.js 的水声节点演示页。1 世界单位 = 1 米。水域直径 20 km、水深 4 km。本地可投放 AUV 节点、发射声波、看时延/损耗/接收级；也可接 Sealinx ACE 实时仿真。

运行：

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Windows 宿主访问（VMware NAT 示例）：`http://192.168.200.128:5173/`  
不要用 `file://` 打开 HTML。Headless Firefox 没有 WebGL，3D 必须在真实浏览器里看。

可选实时桥接：

```bash
./sim/run_live.sh
./sim/stop_live.sh
```

细节见 `sim/README.md`。

---

## 2. 这次到底改了什么

旧页面左右侧栏把「节点列表、投放、删除、TX/RX、坐标、声学、发射、载荷、倍率、链路结果、日志」揉在一起。

新页面职责：

```
顶部：水域名称 / 本地|实时 / 运行提示 / +添加节点
左：节点管理（搜索、列表、选中、...菜单）
中：Three.js 水域（视觉主体）
右：节点详情 Inspector（只编辑 selectedId）
底：通信仿真控制台（TX/RX/载荷/倍率/发射/链路结果 + 日志）
```

点击节点 = 只选中。  
通信面板里的 TX/RX = 链路选择，不等于选中。  
删除不再是左侧常驻大按钮。

---

## 3. 硬约束（不要破）

1. 不更换 Three.js，不重写项目。
2. **不要改** 水声传播、距离、时延、TL/RL、声波半径、到达判定。这些在：
   - `src/acoustics.js`（本次未改）
   - `src/wave.js`（本次未改）
   - `src/main.js` 里 `makePulse` / `updatePhysicsHits` / `onArrival` 只接线，不改公式
3. `src/auv.js`、`src/water.js` 本次未改。
4. 保持深色海洋工业风（青绿 + 琥珀），不要改成普通后台系统。
5. 桌面大屏优先，不必做手机适配。
6. 网页数据库回放入口已按用户要求关掉。`sim/replay_db.py`、`src/api.js`、`src/replayPlayer.js` 留在仓库，**当前 `main.js` 不 import 它们**。不要擅自把回放按钮加回来，除非用户明确要求。

---

## 4. 文件地图

| 文件 | 角色 | 本次 |
|---|---|---|
| `index.html` | 新布局 DOM | 大改 |
| `src/style.css` | 深色工业 HUD | 大改 |
| `src/main.js` | 场景、状态、交互、发射 | UI 接线大改，算法不改 |
| `src/uiBind.js` | 列表 / Inspector / Console / 日志渲染 | 新建 |
| `src/live.js` | SSE 实时包 | 增加 disconnect 与 generation 防串线 |
| `vite.config.js` | 反代 `/events`、`/api` | 加了 `/api` |
| `src/acoustics.js` | 声速、TOF、Thorp、RL、AcousticPulse | **未改** |
| `src/wave.js` | 声环/声线视觉 | **未改** |
| `src/auv.js` `src/water.js` | 模型与水域 | **未改** |
| `src/api.js` `src/replayPlayer.js` | 回放 API / 播放器 | 在仓库但未接到页面 |
| `sim/ace_bridge.py` | ACE 转发 + SSE + 只读 replay HTTP | 加了 `/api/*` |
| `sim/replay_db.py` | 只读 sqlite | 新建，网页暂未接 |
| `docs/viz_contract.md` | 更早的三模式约定，部分已过时 | 参考，以本文和当前 HTML 为准 |
| `工作记录.md` | 历史迭代 | 第 13–15 节是回放阶段 |

逻辑概念（没有强制拆成这些类名，当前就是 `main.js` + `uiBind.js`）：

- NodeManager：增删、列表、`selectedId`
- NodeInspector：当前节点参数
- SimulationController：`txId` / `rxId` / payload / 倍率 / 发射 / 重置
- SceneController：Three.js 显示、选中高亮、Hover、放置、声波动画
- SimulationLog：`state.events`

---

## 5. 统一状态（最重要）

`src/main.js` 的 `state`：

```js
{
  mode: 'local' | 'live',   // 没有 replay
  nodes: [],
  selectedId,               // 正在查看/编辑的节点
  txId,                     // 发射节点，链路选择
  rxId,                     // 接收节点，链路选择
  listenId,                 // 仅 UI 角色；不参与物理判定
  hoveredId,
  menuId,
  addMode,
  pendingAdd,               // { name, depth }
  simTime,
  pulses,
  visuals,
  events,                   // 底部全局日志
  nextId,
}
```

三者必须分开：

- `selectedId`：列表点击、场景点击、Inspector、定位镜头
- `txId` / `rxId`：底部通信控制台、链路预算、声波动画终点
- **底部 TX/RX 下拉不得改 `selectedId`**

同步规则：

- 左列表点击 → `selectedId`
- Three.js 点击节点 → `selectedId`（pointerdown 用 capture + 位移 < 6px 才算点击，避免拖旋转误选）
- Inspector 显示 `selectedId`
- 通信下拉只改 `txId`/`rxId`
- live 包到达会把 `txId`/`rxId` 设成真实 `src`/`dst`，并 `transmitDirected`

删除：

- 删当前选中：选中改为同位置下一个，否则上一个，否则 `null`
- 若删的是 `txId`/`rxId`/`listenId`：**清空对应 id，不要自动改派**

添加：自动选中新节点。

角色互斥（`assignRole`）：一个节点不能同时是 TX、RX、监听。设成其中一个会清掉它身上的其它角色 id。

---

## 6. 节点数据结构

`addNode()` 创建：

```js
{
  id, name,                 // 默认 N{id}
  origin: 'local' | 'live' | 'real',  // 来源/类型；real 预留
  online: true,
  x, y, z,                  // y=0 水面，y<0 水下，深度 = -y
  group, glow, tether, marker, model, propeller, selectRing, label, labelObj, axes,
  hitFlash, float,
  moveEnabled, speed, heading, vSpeed, holdDepth,
  acoustic: { maxRange, sl, freqKhz, thresholdDb, bandwidthKhz },
  phy: { fd, mode, power, guardTime, channel, rate },
  mac: { slotIndex, slotCount, slotDurationMs },
  net: { destination, nextHop },
  logs: [],                 // 节点自己的日志，目前底部用 state.events
  lastRx: { pulse, hit } | null,
}
```

Three.js 对象：

- `nodesGroup` 挂节点
- `waveGroup` 挂声波
- `distGroup` 挂距离线
- `pickPlane` 不可见水平圆，用于点击投放
- 节点 `group.userData.kind === 'node'`
- 选中：黄色 `selectRing`，**不改角色色**
- 角色色在 body 材质上：TX `#e09a4a`，RX `#7eb0d4`，监听 `#5ad4d0`，普通 `#c5c0b5`

**进入物理计算的只有** `acoustic.maxRange / sl / freqKhz / thresholdDb`。  
`bandwidthKhz`、`phy.channel`、`phy.rate` 是预留字段，改了也不会进 `AcousticPulse`。

默认声学：`maxRange 5000`，演示场景会改成 `8000`。  
默认演示 5 点直线，间距 4 km：

```
N1 (-8000,-80,0) ... N5 (8000,-80,0)
txId=1  rxId=5
```

N1→N5 三维距离 16000 m > 8000 m，链路判定为超出作用距离。这是有意的演示，不要“修”成可通信。

已知校验（算法未改，结果应保持）：

- d=16000 m，SL=200 dB，f=12 kHz，c=1480
- tof ≈ 10.81 s
- TL spreading ≈ 84.08 dB
- Thorpe ≈ 26.32 dB
- RL ≈ 89.60 dB

控制台时延显示单位是 **秒**（`hit.tof`），不是毫秒。

---

## 7. 页面交互结构

### 左：节点管理

- 搜索、列表、计数
- 行内容：名称 / 来源 pill / 角色 pill / 状态点
- 点击主区域 = 选中
- `···` 菜单：编辑、TX、RX、监听、定位、复制、删除

来源、角色、状态是三个概念，不要再混：

- 来源：本机节点 / 仿真节点 / 真实节点
- 角色：普通 / TX / RX / 监听
- 状态：在线 / 离线 / 发送中 / 接收中 / 监听中  
  发送中/接收中由当前未结束的 `pulses` 推断（`nodeStatus`）

### 添加节点

顶部 `+ 添加节点` → 对话框：

- 点击水域放置，或输入 X/Z
- 名称、深度
- 点击放置后：场景顶栏「节点放置模式 · 点击水域确定位置 · ESC 取消」
- 鼠标十字，**关闭 Orbit 旋转/平移**
- 点到节点则选中并退出放置；点到水域则创建后退出
- ESC 顺序：关对话框 → 关菜单 → 退出放置

live 模式禁止改布局（`requireLocal()`）。

### 右：Inspector

无选中时：「选择一个节点查看详细信息」

有选中：Tab 基本 / 位置 / 声学 / 通信

- 基本：ID、名称、类型、角色、状态、角色按钮
- 位置：X/Y/Z/深度、应用、定位、水面、按距离放置、到其它节点、巡航
- 声学：SL、频率、带宽、最大作用距离、保护间隔、接收灵敏度（number input，不用一排滑块）
- 通信：MAC/信道/PHY/FD/功率/速率/NET，多数只存字段

正在输入 Inspector 时 `refreshNodes()` 不要把表单刷掉（`filledId` + `activeElement` 判断）。

选中节点不要每次强制飞镜头；只有菜单「定位到节点」或按钮「定位到节点」才 `locateNode()`。

### 底：通信控制台

Tab：通信 / 日志，可折叠。

通信：TX 下拉、RX 下拉、载荷、时间倍率、发射声波、重置传播、重置场景。  
下面是链路结果 + 示波器。

日志：`state.events`，自动跟随、清空。格式：`12.3s  文本`

「显示全部距离」勾选后，除 TX→RX 外再画选中节点到其它节点的距离。默认只画当前 TX→RX。

### 场景文字

- 普通：节点名
- Hover：名 + 位置 + 深度
- 选中：名 + 角色 + 坐标 + 黄色外圈

---

## 8. 发射与物理（不要改公式）

本地「发射声波」`transmit()`：

- 用 `txId` 做源
- `directedDst = null` → **物理上按广播评估所有其它节点**
- 视觉直线画向当前 `rxId`（若有）

live `handleLivePacket` → `transmitDirected(src, dst, payload)`：

- `directedDst = dst.id` → 只评估该接收节点
- 只画真实 src→dst

到达判定在 `AcousticPulse.evaluateNode`：

- `inRange = distance <= maxRange`
- `detectable = RL >= thresholdDb`
- `success = inRange && detectable`

`updatePhysicsHits` 在 `travelTime >= tof`（或半径顶到 maxRange）时调用 `onArrival`。

时间：

- local：`simTime += dt * timescale`
- live：`simTime += dt`（不受倍率下拉影响）

重置传播：清 pulses/visuals、各节点 `lastRx`、浮字。  
重置场景：回到 5 节点演示。

---

## 9. 颜色语义

| 含义 | 颜色 |
|---|---|
| 普通节点 | 中性灰 `#c5c0b5` |
| TX | 橙 `#e09a4a` |
| RX | 蓝 `#7eb0d4` |
| 监听 | 青 `#5ad4d0` |
| 选中 | 黄圈 `#f0d36a`，叠在角色色上，不替换角色色 |
| 成功/链路 | 琥珀 |
| 失败/异常 | 红 |

选中 TX = 橙色体 + 黄色外圈。不要把选中直接改成另一种角色色。

---

## 10. live / 回放现状

`state.mode` 只有 `local` | `live`。HTML 没有回放按钮。

live：`connectSealinxLive({ onPacket, onJoin })`，SSE 先 `/events` 再回退 `:8765/events`。切回 local 必须 `disconnectSealinxLive()`。

`ace_bridge.py` 仍提供：

- `GET /health`
- `GET /events`
- `GET /api/sources`
- `GET /api/replay/events?ids=...`
- `GET /api/nodes/{id}/records`

只扫描 `sim/` 下 sqlite。网页当前不用这些 replay API。

---

## 11. 已做检查 / 残留问题

已在代码层核对：

- 列表选中、场景点击选中、Inspector 跟随
- 添加/删除、TX/RX/监听
- 坐标修改立即更新 mesh
- 发射、声波动画、重置、日志
- 声学公式文件未改
- `node --check` 可通过；无 WebGL 的环境看不到 3D

残留 / 注意：

1. 回放 UI 关闭，相关文件还在。
2. `listenId` 只影响列表/颜色/状态，不改变本地广播物理。
3. `bandwidthKhz` / channel / rate 未进仿真。
4. live 路径（ACE 真包）这次 UI 重构后没有用真实 Sealinx 再跑一遍，改 live 时要手动回归。
5. `docs/viz_contract.md` 仍写着旧三模式和旧 HTML id，部分过时。
6. README 操作说明还写着「点击投放」，与新 UI 不完全一致。
7. 保护间隔在声学 Tab 里编辑，写入的是 `phy.guardTime`，不是声学公式。
8. 节点 `logs` 仍按节点存，底部展示的是全局 `state.events`。

---

## 12. 后续模型改 UI 时请遵守

1. 先读 `index.html`、`src/main.js`、`src/uiBind.js`、`src/style.css`。
2. 改选中逻辑时同时改：列表、场景、Inspector、黄圈、标签。不要再引入第二套 selected。
3. 改 TX/RX 时同步：列表 pill、材质色、控制台下拉、链路预算、TX→RX 距离线。
4. 不要把删除按钮放回左侧顶部。
5. 不要把发射面板塞回 Inspector。
6. 不要让每个节点常驻完整坐标和全部距离。
7. 不要为了 UI 去动 `SOUND_SPEED`、Thorp、spreading、`evaluateNode`。
8. 用户未要求时，不要恢复数据库回放入口。
