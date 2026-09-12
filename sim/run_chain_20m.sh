#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
"${ROOT}/sim/stop_live.sh" || true
sleep 0.5
"${ROOT}/sim/run_live.sh"
echo "capturing 20 minutes of chain traffic..."
sleep 1200
echo "20 minutes reached, stopping"
"${ROOT}/sim/stop_live.sh"
python3 - << 'PY'
import sqlite3, os, glob
root="/home/lyt/Code/three-js-demo/sim/ace_node"
for i in range(1,6):
    p=f"{root}/node{i}/sealinx_records.sqlite3"
    print("====", p, "exists", os.path.isfile(p), "size", os.path.getsize(p) if os.path.isfile(p) else 0)
    if not os.path.isfile(p):
        continue
    db=sqlite3.connect(p)
    tables=[r[0] for r in db.execute("select name from sqlite_master where type='table'")]
    print(" tables", tables)
    for t in ("mac_send_records","mac_receive_records"):
        if t in tables:
            n=db.execute(f"select count(*) from {t}").fetchone()[0]
            print(" ", t, n)
            if n:
                row=db.execute(f"select mac_source_id,mac_destination_id,net_source_id,net_destination_id,app_sequence,mac_sequence from {t} limit 1").fetchone()
                print("  sample", row)
PY
