#!/usr/bin/env python3
"""Read-only Sealinx SQLite replay helpers.

Scans sqlite files under a project ``sim/`` directory and never writes back
to Sealinx. Supports the new MAC send/receive tables and the legacy modem
receive schema used by the ACE live node databases.
"""
from __future__ import print_function

import math
import os
import re
import sqlite3
from collections import OrderedDict

DEFAULT_POS = {
    1: (-8000.0, -80.0, 0.0),
    2: (-4000.0, -80.0, 0.0),
    3: (0.0, -80.0, 0.0),
    4: (4000.0, -80.0, 0.0),
    5: (8000.0, -80.0, 0.0),
}

MAC_TABLES = ("mac_send_records", "mac_receive_records")
MODEM_TABLE = "modem_receive_records"
SQLITE_GLOB = "*.sqlite3"

MAC_COLUMNS = (
    "id",
    "sequence",
    "event_time",
    "message_index",
    "app_sequence",
    "mac_sequence",
    "mac_source_id",
    "mac_destination_id",
    "net_source_id",
    "net_destination_id",
    "net_next_hop_id",
    "phy_source_id",
    "phy_destination_id",
    "phy_fd",
    "phy_mode",
    "phy_type",
    "phy_power_level",
    "phy_guard_time",
    "frame_data",
    "payload_data",
    "payload_length_bytes",
)

MODEM_COLUMNS = (
    "id",
    "receive_time",
    "source",
    "destination",
    "sequence",
    "fd",
    "data_mode",
    "guard_time",
    "payload_size_bytes",
    "packet_kind",
    "raw_debug_text",
    "modem_type",
)

_NODE_DIR_RE = re.compile(r"node(\d+)$", re.I)
_SNR_RE = re.compile(r"SNR\s*[:=]\s*(-?\d+(?:\.\d+)?)", re.I)


def _as_path(value):
    return os.path.abspath(os.path.expanduser(str(value)))


def _is_under(path, root):
    path = os.path.realpath(path)
    root = os.path.realpath(root)
    prefix = root.rstrip(os.sep) + os.sep
    return path == os.path.realpath(root) or path.startswith(prefix)


def _connect_ro(path):
    uri = "file:{}?mode=ro".format(path.replace("?", "%3F"))
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def _tables(con):
    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def _columns(con, table):
    rows = con.execute("PRAGMA table_info({})".format(table)).fetchall()
    return {str(row[1]) for row in rows}


def _select_rows(con, table, wanted):
    present = _columns(con, table)
    cols = [name for name in wanted if name in present]
    if not cols:
        return []
    sql = "SELECT {} FROM {}".format(",".join(cols), table)
    return con.execute(sql).fetchall()


def _as_int(value, default=None):
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


def _as_float(value, default=None):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _row_get(row, key, default=None):
    try:
        value = row[key]
    except (IndexError, KeyError):
        return default
    if value is None:
        return default
    return value


def payload_text(blob, limit=80):
    if blob is None:
        return ""
    if isinstance(blob, memoryview):
        blob = blob.tobytes()
    if isinstance(blob, str):
        blob = blob.encode("utf-8", "replace")
    chars = []
    for byte in blob:
        if not isinstance(byte, int):
            byte = ord(byte)
        if 32 <= byte < 127:
            chars.append(chr(byte))
    return "".join(chars).strip()[:limit]


def event_time_ms(value):
    number = _as_float(value)
    if number is None:
        return None
    if number >= 1e11:
        return int(round(number))
    if number >= 1e9:
        return int(round(number * 1000.0))
    return int(round(number))


def _node_hint_from_path(path):
    parent = os.path.basename(os.path.dirname(path))
    match = _NODE_DIR_RE.match(parent)
    if match:
        return int(match.group(1))
    return None


def source_id_for(path, sim_root):
    path = _as_path(path)
    parent = os.path.basename(os.path.dirname(path))
    name = os.path.splitext(os.path.basename(path))[0]
    if _NODE_DIR_RE.match(parent) and os.path.basename(path) == "sealinx_records.sqlite3":
        return parent
    return name


def iter_sqlite_files(sim_root):
    sim_root = _as_path(sim_root)
    found = []
    for dirpath, dirnames, filenames in os.walk(sim_root):
        dirnames.sort()
        for filename in sorted(filenames):
            if filename.endswith(".sqlite3") and not filename.startswith("."):
                found.append(os.path.join(dirpath, filename))
    return found


def _phy_from_mac(row):
    phy = {}
    mapping = {
        "fd": "phy_fd",
        "mode": "phy_mode",
        "type": "phy_type",
        "power": "phy_power_level",
        "guardTime": "phy_guard_time",
        "src": "phy_source_id",
        "dst": "phy_destination_id",
    }
    for key, column in mapping.items():
        value = _as_int(_row_get(row, column))
        if value is not None:
            phy[key] = value
    return phy or None


def _phy_from_modem(row):
    phy = {}
    fd = _as_int(_row_get(row, "fd"))
    mode = _as_int(_row_get(row, "data_mode"))
    guard = _as_int(_row_get(row, "guard_time"))
    typ = _as_int(_row_get(row, "modem_type"))
    if fd is not None:
        phy["fd"] = fd
    if mode is not None:
        phy["mode"] = mode
    if guard is not None:
        phy["guardTime"] = guard
    if typ is not None:
        phy["type"] = typ
    debug = _row_get(row, "raw_debug_text") or ""
    match = _SNR_RE.search(str(debug))
    if match:
        phy["snr"] = float(match.group(1))
    return phy or None


def _collect_node_ids(row, kind="mac"):
    ids = []
    if kind == "mac":
        keys = (
            "mac_source_id",
            "mac_destination_id",
            "net_source_id",
            "net_destination_id",
            "net_next_hop_id",
            "phy_source_id",
            "phy_destination_id",
        )
    else:
        keys = ("source", "destination")
    for key in keys:
        value = _as_int(_row_get(row, key))
        if value is not None and value not in ids:
            ids.append(value)
    return ids


def _mac_events(con, path, source_id, node_hint):
    events = []
    tables = _tables(con)
    for table, kind in (
        ("mac_send_records", "tx"),
        ("mac_receive_records", "rx"),
    ):
        if table not in tables:
            continue
        for row in _select_rows(con, table, MAC_COLUMNS):
            mac_src = _as_int(_row_get(row, "mac_source_id"))
            mac_dst = _as_int(_row_get(row, "mac_destination_id"))
            net_src = _as_int(_row_get(row, "net_source_id"))
            net_dst = _as_int(_row_get(row, "net_destination_id"))
            src = mac_src if mac_src is not None else _as_int(_row_get(row, "phy_source_id"))
            if src is None:
                src = net_src
            dst = mac_dst if mac_dst is not None else _as_int(_row_get(row, "phy_destination_id"))
            if dst is None:
                dst = net_dst
            t_ms = event_time_ms(_row_get(row, "event_time"))
            if t_ms is None:
                continue
            row_id = _as_int(_row_get(row, "id"), 0)
            if kind == "tx":
                local_id = node_hint if node_hint is not None else src
            else:
                local_id = node_hint if node_hint is not None else dst
            events.append(
                {
                    "kind": kind,
                    "src": src,
                    "dst": dst,
                    "macSrc": mac_src if mac_src is not None else src,
                    "macDst": mac_dst if mac_dst is not None else dst,
                    "netSrc": net_src if net_src is not None else src,
                    "netDst": net_dst if net_dst is not None else dst,
                    "appSeq": _as_int(_row_get(row, "app_sequence")),
                    "macSeq": _as_int(_row_get(row, "mac_sequence")),
                    "seq": _as_int(_row_get(row, "sequence")),
                    "payload": payload_text(_row_get(row, "payload_data")),
                    "phy": _phy_from_mac(row),
                    "nodeId": local_id,
                    "dbId": row_id,
                    "sourceId": source_id,
                    "path": path,
                    "_t_ms": t_ms,
                    "_id": row_id,
                    "_nodes": _collect_node_ids(row, "mac"),
                }
            )
    return events


def _modem_events(con, path, source_id, node_hint):
    events = []
    if MODEM_TABLE not in _tables(con):
        return events
    for row in _select_rows(con, MODEM_TABLE, MODEM_COLUMNS):
        src = _as_int(_row_get(row, "source"))
        dst = _as_int(_row_get(row, "destination"))
        t_ms = event_time_ms(_row_get(row, "receive_time"))
        if t_ms is None:
            continue
        row_id = _as_int(_row_get(row, "id"), 0)
        payload = payload_text(_row_get(row, "packet_kind") or "")
        events.append(
            {
                "kind": "rx",
                "src": src,
                "dst": dst,
                "macSrc": src,
                "macDst": dst,
                "netSrc": src,
                "netDst": dst,
                "appSeq": None,
                "macSeq": None,
                "seq": _as_int(_row_get(row, "sequence")),
                "payload": payload,
                "phy": _phy_from_modem(row),
                "nodeId": node_hint if node_hint is not None else dst,
                "dbId": row_id,
                "sourceId": source_id,
                "path": path,
                "_t_ms": t_ms,
                "_id": row_id,
                "_nodes": _collect_node_ids(row, "modem"),
            }
        )
    return events


def _read_file_events(path, sim_root=None):
    path = _as_path(path)
    source_id = source_id_for(path, sim_root or os.path.dirname(path))
    node_hint = _node_hint_from_path(path)
    con = _connect_ro(path)
    try:
        events = _mac_events(con, path, source_id, node_hint)
        if events:
            return events
        return _modem_events(con, path, source_id, node_hint)
    finally:
        con.close()


def _inspect_file(path, sim_root):
    path = _as_path(path)
    rel = path
    if _is_under(path, sim_root):
        rel = os.path.relpath(path, sim_root)
    node_hint = _node_hint_from_path(path)
    info = {
        "id": source_id_for(path, sim_root),
        "path": rel.replace("\\", "/"),
        "label": os.path.basename(os.path.dirname(path))
        if os.path.basename(path) == "sealinx_records.sqlite3"
        else os.path.splitext(os.path.basename(path))[0],
        "nodeHint": node_hint,
        "schema": "empty",
        "sendCount": 0,
        "recvCount": 0,
        "modemCount": 0,
        "nodes": [],
    }
    try:
        con = _connect_ro(path)
    except sqlite3.Error:
        return info
    try:
        tables = _tables(con)
        node_ids = []
        if "mac_send_records" in tables:
            info["sendCount"] = int(
                con.execute("SELECT COUNT(*) FROM mac_send_records").fetchone()[0]
            )
            for row in _select_rows(con, "mac_send_records", MAC_COLUMNS):
                for nid in _collect_node_ids(row, "mac"):
                    if nid not in node_ids:
                        node_ids.append(nid)
        if "mac_receive_records" in tables:
            info["recvCount"] = int(
                con.execute("SELECT COUNT(*) FROM mac_receive_records").fetchone()[0]
            )
            for row in _select_rows(con, "mac_receive_records", MAC_COLUMNS):
                for nid in _collect_node_ids(row, "mac"):
                    if nid not in node_ids:
                        node_ids.append(nid)
        if MODEM_TABLE in tables:
            info["modemCount"] = int(
                con.execute("SELECT COUNT(*) FROM modem_receive_records").fetchone()[0]
            )
            try:
                for row in con.execute(
                    "SELECT DISTINCT source, destination FROM modem_receive_records"
                ):
                    dummy = {"source": row[0], "destination": row[1]}
                    for nid in _collect_node_ids(dummy, "modem"):
                        if nid not in node_ids:
                            node_ids.append(nid)
            except sqlite3.Error:
                pass
        has_mac = "mac_send_records" in tables or "mac_receive_records" in tables
        has_modem = MODEM_TABLE in tables
        if info["sendCount"] or info["recvCount"]:
            info["schema"] = "mac"
        elif info["modemCount"]:
            info["schema"] = "modem"
        elif has_mac:
            info["schema"] = "mac"
        elif has_modem:
            info["schema"] = "modem"
        else:
            info["schema"] = "empty"
        if node_hint is not None and node_hint not in node_ids:
            node_ids.append(node_hint)
        info["nodes"] = sorted(nid for nid in node_ids if nid is not None)
        return info
    except sqlite3.Error:
        return info
    finally:
        con.close()


def list_sources(sim_root):
    sim_root = _as_path(sim_root)
    sources = []
    seen_ids = {}
    for path in iter_sqlite_files(sim_root):
        info = _inspect_file(path, sim_root)
        source_id = info["id"]
        if source_id in seen_ids:
            info["id"] = "{}_{}".format(source_id, seen_ids[source_id] + 1)
        seen_ids[source_id] = seen_ids.get(source_id, 0) + 1
        sources.append(info)
    sources.sort(key=lambda item: (item.get("label") or "", item.get("id") or ""))
    return sources


def _position_for(node_id, unknown_ids):
    known = DEFAULT_POS.get(node_id)
    if known is not None:
        x, y, z = known
        return {"x": x, "y": y, "z": z}
    count = max(len(unknown_ids), 1)
    index = unknown_ids.index(node_id) if node_id in unknown_ids else 0
    angle = (2.0 * math.pi * index) / count
    radius = 5000.0
    return {
        "x": round(radius * math.cos(angle), 3),
        "y": -80.0,
        "z": round(radius * math.sin(angle), 3),
    }


def _public_event(event, t):
    return {
        "t": t,
        "kind": event["kind"],
        "src": event.get("macSrc", event["src"]),
        "dst": event.get("macDst", event["dst"]),
        "macSrc": event.get("macSrc", event.get("src")),
        "macDst": event.get("macDst", event.get("dst")),
        "netSrc": event.get("netSrc", event.get("src")),
        "netDst": event.get("netDst", event.get("dst")),
        "appSeq": event.get("appSeq"),
        "macSeq": event.get("macSeq"),
        "seq": event.get("seq"),
        "payload": event.get("payload") or "",
        "phy": event.get("phy"),
        "nodeId": event.get("nodeId"),
        "dbId": event.get("dbId"),
        "sourceId": event.get("sourceId"),
        "matched": event.get("matched"),
        "rxTime": event.get("rxTime"),
    }


def _merge_raw_events(paths, sim_root=None):
    merged = []
    for path in paths or []:
        path = _as_path(path)
        if not os.path.isfile(path):
            continue
        merged.extend(_read_file_events(path, sim_root=sim_root))
    merged.sort(
        key=lambda ev: (
            ev["_t_ms"],
            ev.get("_id") or 0,
            0 if ev["kind"] == "tx" else 1,
            ev.get("sourceId") or "",
        )
    )
    return merged


def _build_nodes(raw_events):
    phy_by_node = {}
    node_ids = []
    for event in raw_events:
        for nid in event.get("_nodes") or []:
            if nid not in node_ids:
                node_ids.append(nid)
        src = event.get("src")
        dst = event.get("dst")
        phy = event.get("phy") or {}
        if src is not None and src not in node_ids:
            node_ids.append(src)
        if dst is not None and dst not in node_ids:
            node_ids.append(dst)
        owner = event.get("nodeId")
        if owner is not None and phy:
            current = phy_by_node.get(owner, {})
            current.update({k: v for k, v in phy.items() if v is not None})
            phy_by_node[owner] = current
        if src is not None and phy:
            current = phy_by_node.get(src, {})
            snapshot = dict(phy)
            if "src" in snapshot:
                snapshot.pop("src", None)
            current.update({k: v for k, v in snapshot.items() if v is not None})
            phy_by_node[src] = current
    node_ids = sorted({nid for nid in node_ids if nid is not None})
    unknown = [nid for nid in node_ids if nid not in DEFAULT_POS]
    nodes = []
    for nid in node_ids:
        pos = _position_for(nid, unknown)
        node = {"id": nid, "x": pos["x"], "y": pos["y"], "z": pos["z"]}
        if phy_by_node.get(nid):
            node["phy"] = phy_by_node[nid]
        nodes.append(node)
    return nodes


def _dedup_raw_events(raw):
    """Collapse the same hop recorded by multiple node databases."""
    seen = set()
    out = []
    for event in raw:
        bucket = int((event.get("_t_ms") or 0) // 200)
        key = (
            event.get("kind"),
            event.get("macSrc", event.get("src")),
            event.get("macDst", event.get("dst")),
            event.get("macSeq"),
            event.get("netSrc", event.get("src")),
            event.get("netDst", event.get("dst")),
            event.get("appSeq"),
            event.get("seq"),
            bucket,
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(event)
    return out


def _mac_link_key(event):
    return (
        event.get("macSrc", event.get("src")),
        event.get("macDst", event.get("dst")),
        event.get("macSeq"),
    )


def _app_flow_key(event):
    return (
        event.get("netSrc", event.get("src")),
        event.get("netDst", event.get("dst")),
        event.get("appSeq"),
    )


def _pair_mac_hops(raw):
    """Point-to-point: (macSrc, macDst, macSeq). End-to-end stays on APP/NET."""
    txs = [item for item in raw if item.get("kind") == "tx"]
    rxs = [item for item in raw if item.get("kind") == "rx"]
    used = set()
    hops = []
    for tx in txs:
        key = _mac_link_key(tx)
        best = None
        for index, rx in enumerate(rxs):
            if index in used:
                continue
            if _mac_link_key(rx) != key:
                continue
            if key[2] is None and rx.get("seq") != tx.get("seq"):
                continue
            delta = (rx.get("_t_ms") or 0) - (tx.get("_t_ms") or 0)
            if delta < -2000 or delta > 30000:
                continue
            if best is None or abs(delta) < abs(best[0]):
                best = (delta, index, rx)
        hop = dict(tx)
        hop["kind"] = "hop"
        if best is not None:
            used.add(best[1])
            hop["matched"] = True
            hop["_rx_ms"] = best[2]["_t_ms"]
        else:
            hop["matched"] = False
        hops.append(hop)
    for index, rx in enumerate(rxs):
        if index not in used:
            leftover = dict(rx)
            leftover["matched"] = False
            hops.append(leftover)
    hops.sort(key=lambda item: (item["_t_ms"], item.get("_id") or 0))
    return hops


def _group_app_flows(hops, t0_ms):
    groups = OrderedDict()
    for hop in hops:
        key = _app_flow_key(hop)
        groups.setdefault(key, []).append(hop)
    flows = []
    for (net_src, net_dst, app_seq), items in groups.items():
        flows.append({
            "netSrc": net_src,
            "netDst": net_dst,
            "appSeq": app_seq,
            "count": len(items),
            "t": (items[0]["_t_ms"] - t0_ms) / 1000.0,
            "src": items[0].get("macSrc", items[0].get("src")),
            "dst": items[-1].get("macDst", items[-1].get("dst")),
        })
    return flows


def load_events(paths, sim_root=None):
    raw = _dedup_raw_events(_merge_raw_events(paths, sim_root=sim_root))
    if not raw:
        return {
            "nodes": [],
            "events": [],
            "hops": [],
            "flows": [],
            "t0_ms": None,
            "duration": 0.0,
        }
    t0_ms = raw[0]["_t_ms"]
    events = []
    for item in raw:
        t = (item["_t_ms"] - t0_ms) / 1000.0
        events.append(_public_event(item, t))
    paired = _pair_mac_hops(raw)
    hops = []
    for item in paired:
        public = _public_event(item, (item["_t_ms"] - t0_ms) / 1000.0)
        if item.get("_rx_ms") is not None:
            public["rxTime"] = (item["_rx_ms"] - t0_ms) / 1000.0
        if public.get("macSrc") == public.get("macDst"):
            continue
        hops.append(public)
    duration = events[-1]["t"] if events else 0.0
    return {
        "nodes": _build_nodes(raw),
        "events": events,
        "hops": hops,
        "flows": _group_app_flows(paired, t0_ms),
        "t0_ms": t0_ms,
        "duration": duration,
    }


def _event_belongs(event, raw, node_id):
    node_id = _as_int(node_id)
    if node_id is None:
        return False
    kind = event.get("kind")
    src = event.get("src")
    dst = event.get("dst")
    local = event.get("nodeId")
    path = raw.get("path") or ""
    hint = _node_hint_from_path(path)
    if kind == "tx":
        return src == node_id or local == node_id
    if hint is not None:
        return hint == node_id or local == node_id
    return dst == node_id or local == node_id


def node_records(paths, node_id, sim_root=None):
    node_id = _as_int(node_id)
    raw = _merge_raw_events(paths, sim_root=sim_root)
    send = []
    recv = []
    if not raw:
        return {
            "nodeId": node_id,
            "send": [],
            "recv": [],
            "sendCount": 0,
            "recvCount": 0,
        }
    t0_ms = raw[0]["_t_ms"]
    for item in raw:
        t = (item["_t_ms"] - t0_ms) / 1000.0
        public = _public_event(item, t)
        if not _event_belongs(public, item, node_id):
            continue
        if public["kind"] == "tx":
            send.append(public)
        else:
            recv.append(public)
    return {
        "nodeId": node_id,
        "send": send,
        "recv": recv,
        "sendCount": len(send),
        "recvCount": len(recv),
    }


def sources_by_id(sim_root):
    mapping = OrderedDict()
    for source in list_sources(sim_root):
        mapping[source["id"]] = source
    return mapping


def resolve_source_paths(sim_root, ids=None):
    sim_root = _as_path(sim_root)
    sources = list_sources(sim_root)
    if not ids:
        return [os.path.join(sim_root, item["path"]) for item in sources]
    wanted = set(ids)
    paths = []
    for item in sources:
        if item["id"] in wanted:
            paths.append(os.path.join(sim_root, item["path"]))
    return paths
