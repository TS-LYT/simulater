# 可视化三模式约定（给实现用）

不改 `/home/lyt/Code/new-sealinx` 源码。SQLite 只读。位置由网页维护。

## 三种模式 `state.mode`

- `local` 网页自己投放 / 巡航 / 发射
- `live` ACE 桥接实时包，只画真实 `src → dst`
- `replay` 读节点 SQLite，按时间回放流向

## 每节点独立数据

全局不再共用一套发射参数。选中节点后，左侧检查器只显示该节点：

- 坐标、与其它节点距离
- 声学：maxRange / SL / freq / threshold
- PHY：fd / mode / power / guardTime
- MAC：slotIndex / slotCount / slotDurationMs
- NET：destination / nextHop
- 本节点 TX/RX 日志

右侧面板也只服务当前选中节点。

## HTML id（禁止改名）

- `#mode-local` `#mode-live` `#mode-replay`
- `#live-status`
- `#node-list` `#node-empty`
- `#insp-id` `#insp-origin` `#insp-role`
- `#pos-x` `#pos-y` `#pos-z` `#btn-apply-pos` `#btn-surface`
- `#rel-dist` `#btn-rel-dist`
- `#dist-list`
- `#n-range` `#n-range-val` `#n-sl` `#n-sl-val` `#n-freq` `#n-freq-val` `#n-th` `#n-th-val`
- `#n-fd` `#n-phy-mode` `#n-power` `#n-guard`
- `#n-slot-index` `#n-slot-count` `#n-slot-ms`
- `#n-net-dst` `#n-net-hop`
- `#move-enabled` `#move-speed` `#move-heading` `#move-vspeed` `#move-hold` `#btn-move-apply` `#btn-move-stop`
- `#btn-add` `#btn-remove` `#btn-tx` `#btn-rx` `#add-depth` `#depth-val` `#mode-hint`
- `#payload` `#timescale` `#scale-val` `#btn-ping` `#btn-demo`
- `#local-controls` `#live-controls` `#replay-controls`
- `#replay-sources` `#btn-replay-scan` `#btn-replay-load`
- `#btn-replay-play` `#btn-replay-pause` `#btn-replay-step` `#btn-replay-reset`
- `#replay-speed` `#replay-progress` `#replay-time`
- `#rx-meta` `#scope` `#decode-text` `#physics` `#log`

## HTTP（ace_bridge :8765，Vite 反代 `/api` `/events` `/health`）

只扫描 `sim/` 下 sqlite，禁止任意路径。

- `GET /health` `{"ok":true}`
- `GET /api/sources`  
  `{sources:[{id,path,label,nodeHint,schema,sendCount,recvCount,modemCount,nodes:[1,2]}]}`
  schema: `mac` | `modem` | `empty`
- `GET /api/replay/events?ids=node1,node2`  
  `{nodes:[...], events:[{t,kind,src,dst,appSeq,macSeq,seq,payload,phy,nodeId,dbId}]}`  
  `kind`: `tx` | `rx`  
  `t` 为相对首事件秒。MAC 用 send/recv 表；旧库用 `modem_receive_records`（仅 rx，src/dst/sequence）。
- `GET /api/nodes/{id}/records?ids=...` 该节点自己的收发摘要

## 默认坐标（米）

未知节点按 5 km 环放置。已知：

- 1: (0,-80,0)  2: (5000,-80,0)  3: (2500,-80,4330)

## 逻辑

- live/replay 只动画真实 dst，不广播。
- local 发射用选中节点自己的声学参数，直线画向当前监听节点。
- 回放按事件时间推进，直线仍按 1480 m/s 生长。
