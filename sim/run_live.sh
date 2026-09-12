#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK="${ROOT}/sim/ace_node"
LOG="${ROOT}/sim/logs"
mkdir -p "${LOG}"

if [[ ! -x "${PACK}/simulator/sealinx_ace_simulator" ]]; then
    echo "missing ${PACK}/simulator/sealinx_ace_simulator"
    exit 1
fi

kill_port() {
    local port="$1"
    local pids
    pids="$(ss -lptn "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)"
    if [[ -n "${pids}" ]]; then
        echo "free port ${port}: ${pids}"
        kill ${pids} 2>/dev/null || true
        sleep 0.3
    fi
}

pkill -f "sealinx_stack_manual" 2>/dev/null || true
pkill -f "sealinx_ace_simulator" 2>/dev/null || true
pkill -f "ace_bridge.py" 2>/dev/null || true
kill_port 6666
kill_port 16666
kill_port 8765
sleep 0.2

start_bg() {
    local name="$1"
    shift
    setsid "$@" </dev/null >"${LOG}/${name}.log" 2>&1 &
    echo $! > "${LOG}/${name}.pid"
}

echo "start official ACE simulator :16666"
start_bg simulator "${PACK}/simulator/sealinx_ace_simulator" --host 127.0.0.1 --port 16666
sleep 0.5

echo "start ACE->web bridge :6666 / :8765"
start_bg bridge python3 "${ROOT}/sim/ace_bridge.py" --listen 6666 --backend 127.0.0.1:16666 --http 8765
sleep 0.4

start_node() {
    local id="$1"
    echo "start node ${id}"
    start_bg "node${id}" bash -c "cd '${PACK}/node${id}' && exec ./run.sh"
}

start_node 5
sleep 0.3
start_node 4
sleep 0.3
start_node 3
sleep 0.3
start_node 2
sleep 0.3
start_node 1

echo "live pids:"
for f in simulator bridge node5 node4 node3 node2 node1; do
    echo "  ${f}=$(cat "${LOG}/${f}.pid")"
done
echo "web: http://localhost:5173/"
echo "sse: http://127.0.0.1:8765/events"
echo "logs: ${LOG}"
