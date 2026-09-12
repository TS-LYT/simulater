# 仿真桥接（不改 Sealinx 源码）

本目录把 `/home/lyt/Code/new-sealinx` 接到 Three.js 网页，官方源码保持不动。
包装、桥接、SQLite 只读回放都放在本仓库的 `sim/`。

## 三种模式

网页 `state.mode`：

- `local`：网页自己投放 / 巡航 / 发射，用选中节点的声学参数。
- `live`：ACE 桥接实时包。节点仍连本机 `6666`，`ace_bridge.py` 原样转发到官方 `sealinx_ace_simulator`，同时解析 `phy.src / phy.dst` 经 SSE 推给网页。只画真实 `src → dst`，不广播。
- `replay`：只读扫描 `sim/` 下已有 SQLite（`ace_node/node*/sealinx_records.sqlite3` 与 `sim/fixtures/*.sqlite3`），按事件时间回放流向。不改 Sealinx，不写回数据库。

默认三节点等边 5 km：

- N1 `(0, -80, 0)`
- N2 `(5000, -80, 0)`
- N3 `(2500, -80, 4330)`

未知节点按 5 km 环放置。

## HTTP API（`ace_bridge.py` :8765）

Vite 把 `/api`、`/events`、`/health` 反代到 `http://127.0.0.1:8765`（`/events` timeout 0）。

- `GET /health` → `{"ok": true}`
- `GET /events` → SSE 实时包（live）
- `GET /api/sources` → `{sources:[{id,path,label,nodeHint,schema,sendCount,recvCount,modemCount,nodes:[1,2]}]}`  
  `schema` 为 `mac` | `modem` | `empty`
- `GET /api/replay/events?ids=node1,node2`  
  省略 `ids` 则合并全部源。  
  `{nodes:[...], events:[{t,kind,src,dst,appSeq,macSeq,seq,payload,phy,nodeId,dbId}], t0_ms, duration}`  
  `kind` 为 `tx` | `rx`；`t` 为相对首事件的秒。
- `GET /api/nodes/{id}/records?ids=...` → 该节点自己的收发摘要

只扫描 `sim/` 下 sqlite，禁止任意路径。`ids` 是 `/api/sources` 返回的源 id，不是文件系统路径。

## 回放如何读库（不改 Sealinx）

Sealinx 节点自己写入 `sealinx_records.sqlite3`。本仓库用 stdlib `sqlite3` 只读打开：

1. **新 MAC（v5）**：`mac_send_records` / `mac_receive_records`。  
   `tx` 用 send 表，`rx` 用 receive 表；`src/dst` 取 MAC 一跳地址；payload 来自 `payload_data` 可打印字节（strip，最长 80）。
2. **旧 Modem 接收**：现有 live 库 `sim/ace_node/node1|2|3/sealinx_records.sqlite3` 的 `modem_receive_records`。  
   仅 `rx`；`src=source`，`dst=destination`，`seq=sequence`。可选从 `raw_debug_text` 解析 SNR。

多库按绝对 `event_time`（毫秒）再按行 `id` 合并，再换成相对秒。

夹具 `sim/fixtures/mac_replay.sqlite3` 由 `python3 sim/test_replay.py` 生成，含 N1→N2→N3→N1 三跳。

## 数据路径（live）

```
sealinx_stack_manual ×3  周期发包
    TCP :6666
        ace_bridge.py
            转发给官方 sealinx_ace_simulator :16666
            SSE / JSON http://127.0.0.1:8765 → 网页
```

## 准备 ACE 测试包（本机一次）

```bash
cd /home/lyt/Code/new-sealinx
SEALINX_MANUAL_ACE_OUTPUT_DIR=/home/lyt/Code/three-js-demo/sim/ace_node \
  ./build_manual_ace.sh
```

`sim/ace_node/` 体积较大且含二进制，已加入 `.gitignore`。

## 启动 / 停止

先开网页：

```bash
cd /home/lyt/Code/three-js-demo
npm install
npm run dev
```

再开仿真：

```bash
./sim/run_live.sh
```

浏览器打开 http://localhost:5173/ 。live 状态栏应显示「仿真桥接已连接」；replay 点「扫描库」读 `/api/sources`。

停止：

```bash
./sim/stop_live.sh
```

回放自测：

```bash
python3 sim/test_replay.py
```
