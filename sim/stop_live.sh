#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${ROOT}/sim/logs"
if [[ -d "${LOG}" ]]; then
    for f in "${LOG}"/*.pid; do
        [[ -f "$f" ]] || continue
        pid="$(cat "$f" || true)"
        if [[ -n "${pid}" ]]; then
            kill "${pid}" 2>/dev/null || true
            kill -- -"${pid}" 2>/dev/null || true
        fi
        rm -f "$f"
    done
fi
pkill -f "sealinx_stack_manual" 2>/dev/null || true
pkill -f "sealinx_ace_simulator" 2>/dev/null || true
pkill -f "ace_bridge.py" 2>/dev/null || true
echo "stopped live sim"
