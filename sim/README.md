# 仿真桥接（不改 Sealinx 源码）

本目录把 `/home/lyt/Code/new-sealinx` 的 ACE 仿真接到 Three.js 网页。
官方源码保持不动；需要的包装、桥接和启动脚本都放在本仓库。

## 数据路径

```
sealinx_stack_manual ×3  周期发包
    TCP :6666
        ace_bridge.py
            转发给官方 sealinx_ace_simulator :16666
            SSE http://127.0.0.1:8765/events → 网页
```

默认三节点等边 5 km：

- N1 `(0, -80, 0)`
- N2 `(5000, -80, 0)`
- N3 `(2500, -80, 4330)`

跳：N1→N2，N2→N3，N3→N1。

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

浏览器打开 http://localhost:5173/ ，状态栏应显示「仿真桥接已连接」。

停止：

```bash
./sim/stop_live.sh
```
