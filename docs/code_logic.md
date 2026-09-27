# 当前代码逻辑

本文对应当前 `main` 分支的实现。运行入口为 `index.html` → `src/main.js`；网页可选 `local`（本地）和 `live`（实时）模式。`src/replayPlayer.js`、`src/api.js` 和 `sim/replay_db.py` 保留，但 `src/main.js` 未接入网页回放入口。

## 模块与数据流

| 模块 | 职责 |
| --- | --- |
| `src/main.js` | 创建场景、维护页面状态、绑定交互、推进仿真时钟与渲染 |
| `src/uiBind.js`、`src/networkPanel.js` | 节点列表、详情、通信控制台及本地组网面板 |
| `src/acoustics.js`、`src/propagation.js` | 声学计算、脉冲接收者与到达判定 |
| `src/network.js` | 本地拓扑、路由、TDMA、逐跳包队列和事件调度 |
| `src/wave.js`、`src/visualizationConfig.js`、`src/CameraController.js` | 波前、显示缩放和镜头；显示缩放不参与物理计算 |
| `src/live.js`、`sim/ace_bridge.py` | EventSource 接收 ACE 桥接事件，转成实时节点与定向发射 |
| `sim/replay_db.py` | SQLite 只读扫描与回放 API，当前不在网页播放路径中 |

主循环 `animate()` 根据墙钟 `dt` 计算 `simDt`，依次更新节点运动、`LocalNetworkSimulator`、声学命中、波形与界面，再渲染 Three.js 和 CSS2D 标签。本地时间由倍率控件缩放；实时模式用 1 倍时间；本地组网暂停时 `simDt = 0`，镜头仍可操作。

## 页面状态与节点

`state.nodes` 是页面节点列表。`selectedId` 决定列表/详情/场景选中，`txId` 与 `rxId` 决定通信链路，`listenId` 是单独的界面角色。节点保存物理坐标 `x/y/z`（米，水下 `y < 0`）、声学参数、PHY/MAC/NET 字段和 Three.js 对象。`resetDemo()` 创建五节点错落水下布局；添加、删除或移动节点由 `main.js` 更新场景和面板。

发射使用 `acoustic.maxRange`、`sl`、`freqKhz`、`thresholdDb`。部分 PHY/MAC/NET 输入保留作配置展示；自动组网读取节点的声学参数和 `phy.guardTime`，并使用组网面板的包长、有效比特率、拓扑与调度设置。`bandwidthKhz` 等字段不进入当前 `AcousticPulse` 计算。

## 手动发送与声学判定

1. 本地按钮调用 `transmit()`；`makePulse()` 固定发射瞬间的源坐标与声学参数。目标发送需要选择不同的 TX/RX；广播面向其它在线节点。
2. `configureRecipients()` 在发射时固定候选节点 ID。目标发送还允许覆盖范围内的其它在线节点旁听；实时定向包只选真实目的节点。
3. `AcousticPulse.evaluateNode()` 用真实三维坐标算距离 `d`、时延 `d / 1480`、球面扩展 `20 log10(max(d,1))` 和 Thorp 吸收；接收级为 `SL - 扩展损耗 - 吸收损耗`。
4. `advanceRecipient()` 根据传播时间与当前位置判定到达；到达后 `onArrival()` 按作用距离和门限写成功、超距或低于门限的日志。目标发送的旁听结果会单独标记。
5. `src/wave.js` 绘制随声学半径增长的波前与链路线；`visualizationConfig.js` 的模型缩放仅影响画面，不改变坐标、距离或接收结果。

## 本地自动组网

`LocalNetworkSimulator` 只在本地模式运行。自动拓扑在可达边上先选最少跳数、再选总传播时延；链状只允许列表中的下一跳；簇状先到簇头，再由簇头到汇聚节点。路由每帧重新计算，发送时还会按当前节点和已访问路径求下一跳。

每帧按配置周期生成到汇聚节点的数据包。调度可按节点 ID、路由远端优先，或簇成员后簇头的两阶段顺序排列。默认包长 32 字节、有效速率 2400 bit/s；安全时隙至少覆盖发送时长、最大作用距离的传播时延和保护间隔。每个时隙至多从发送节点 FIFO 取一包，队列上限 32、包寿命 120 仿真秒、最多 16 跳。

`network.update(toTime)` 按下一时隙、前沿到达、完整接收和超时事件推进，因此事件顺序不依赖渲染帧率。到达前沿只标记接收中；完整接收且链路成功后，包才送达汇聚节点或入下一跳队列。`handleNetworkEvent()` 把发送/到达/接收/丢弃事件转为场景波形、提示与日志。当前没有 ACK、重传、碰撞或数据融合。

## 实时桥接与边界

切到实时模式会停止本地组网并通过 `src/live.js` 连接 `/events`（失败时回退到 `:8765/events`）。`join` 事件增补节点；`packet` 事件根据真实 `src/dst` 创建定向脉冲并合并收到的 PHY 字段。切回本地模式会关闭旧 EventSource。Vite 将 `/events`、`/api`、`/health` 反代到本地桥接服务；桥接与只读数据库细节见 [sim/README.md](../sim/README.md)。

本地组网与实时 ACE 包是两条路径；网页回放入口仍关闭。声学模型只包含直达路径、固定声速、球面扩展与 Thorp 吸收，没有折射、多普勒、反射、ACK 或碰撞模型。

## 验证命令

```bash
npm run build
node --test src/*.test.js
python3 sim/test_replay.py
```
