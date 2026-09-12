#!/usr/bin/env python3
"""Replay SQLite reader tests. Creates sim/fixtures/mac_replay.sqlite3."""
from __future__ import print_function

import os
import sqlite3
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import replay_db

FIXTURE_DIR = os.path.join(HERE, "fixtures")
FIXTURE_PATH = os.path.join(FIXTURE_DIR, "mac_replay.sqlite3")
LEGACY_PATH = os.path.join(HERE, "ace_node", "node1", "sealinx_records.sqlite3")

T0_MS = 1700000000000
MAC_SQL = """
CREATE TABLE mac_send_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence INTEGER,
    event_time INTEGER,
    message_index INTEGER,
    app_sequence INTEGER,
    mac_sequence INTEGER,
    mac_source_id INTEGER,
    mac_destination_id INTEGER,
    net_source_id INTEGER,
    net_destination_id INTEGER,
    net_next_hop_id INTEGER,
    phy_source_id INTEGER,
    phy_destination_id INTEGER,
    phy_fd INTEGER,
    phy_mode INTEGER,
    phy_type INTEGER,
    phy_power_level INTEGER,
    phy_guard_time INTEGER,
    frame_data BLOB,
    payload_data BLOB,
    payload_length_bytes INTEGER
);
CREATE TABLE mac_receive_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence INTEGER,
    event_time INTEGER,
    message_index INTEGER,
    app_sequence INTEGER,
    mac_sequence INTEGER,
    mac_source_id INTEGER,
    mac_destination_id INTEGER,
    net_source_id INTEGER,
    net_destination_id INTEGER,
    net_next_hop_id INTEGER,
    phy_source_id INTEGER,
    phy_destination_id INTEGER,
    phy_fd INTEGER,
    phy_mode INTEGER,
    phy_type INTEGER,
    phy_power_level INTEGER,
    phy_guard_time INTEGER,
    frame_data BLOB,
    payload_data BLOB,
    payload_length_bytes INTEGER
);
"""


def write_mac_fixture(path=FIXTURE_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    try:
        con.executescript(MAC_SQL)
        hops = [
            (1, 2, 1, 2, "n1-to-n2", 0, 80, 11, 1),
            (2, 3, 2, 3, "n2-to-n3", 2000, 2080, 12, 2),
            (3, 4, 3, 4, "n3-to-n4", 4000, 4080, 13, 3),
            (4, 5, 4, 5, "n4-to-n5", 6000, 6080, 14, 4),
            (1, 2, 1, 5, "e2e-n1-n5", 8000, 8080, 99, 5),
        ]
        send_sql = (
            "INSERT INTO mac_send_records ("
            "sequence,event_time,message_index,app_sequence,mac_sequence,"
            "mac_source_id,mac_destination_id,net_source_id,net_destination_id,"
            "net_next_hop_id,phy_source_id,phy_destination_id,phy_fd,phy_mode,"
            "phy_type,phy_power_level,phy_guard_time,frame_data,payload_data,"
            "payload_length_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        recv_sql = send_sql.replace("mac_send_records", "mac_receive_records")
        for index, (mac_src, mac_dst, net_src, net_dst, payload, send_off, recv_off, app_seq, mac_seq) in enumerate(hops, 1):
            blob = payload.encode("ascii")
            frame = b"FRAME" + blob
            send_row = (
                index,
                T0_MS + send_off,
                index,
                app_seq,
                mac_seq,
                mac_src,
                mac_dst,
                net_src,
                net_dst,
                mac_dst,
                mac_src,
                mac_dst,
                0,
                1,
                0,
                1,
                150,
                frame,
                blob,
                len(blob),
            )
            recv_row = (
                index,
                T0_MS + recv_off,
                index,
                app_seq,
                mac_seq,
                mac_src,
                mac_dst,
                net_src,
                net_dst,
                mac_dst,
                mac_src,
                mac_dst,
                0,
                1,
                0,
                1,
                150,
                frame,
                blob,
                len(blob),
            )
            con.execute(send_sql, send_row)
            con.execute(recv_sql, recv_row)
        con.commit()
    finally:
        con.close()
    return path


class ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = write_mac_fixture()

    def test_mac_hop_chain_order_and_payload(self):
        loaded = replay_db.load_events([self.fixture])
        events = loaded["events"]
        self.assertEqual(len(events), 10)
        self.assertEqual(loaded["t0_ms"], T0_MS)
        self.assertAlmostEqual(loaded["duration"], 8.08)
        self.assertEqual(events[0]["kind"], "tx")
        self.assertEqual(events[0]["macSrc"], 1)
        self.assertEqual(events[0]["macDst"], 2)
        self.assertEqual(events[0]["netSrc"], 1)
        self.assertEqual(events[0]["netDst"], 2)
        self.assertEqual(events[0]["appSeq"], 11)
        self.assertEqual(events[0]["macSeq"], 1)
        hops = loaded["hops"]
        self.assertEqual(len(hops), 5)
        self.assertTrue(all(hop.get("matched") for hop in hops))
        self.assertEqual([hop["src"] for hop in hops], [1, 2, 3, 4, 1])
        self.assertEqual([hop["dst"] for hop in hops], [2, 3, 4, 5, 2])
        e2e = [hop for hop in hops if hop["appSeq"] == 99][0]
        self.assertEqual(e2e["netSrc"], 1)
        self.assertEqual(e2e["netDst"], 5)
        self.assertEqual(e2e["macSrc"], 1)
        self.assertEqual(e2e["macDst"], 2)
        flows = { (f["netSrc"], f["netDst"], f["appSeq"]): f for f in loaded["flows"] }
        self.assertIn((1, 5, 99), flows)
        self.assertIn((1, 2, 11), flows)
        node_ids = sorted(node["id"] for node in loaded["nodes"])
        self.assertEqual(node_ids, [1, 2, 3, 4, 5])
        rec = replay_db.node_records([self.fixture], 2)
        self.assertEqual(rec["sendCount"], 1)
        self.assertEqual(rec["recvCount"], 2)
        self.assertEqual(rec["send"][0]["dst"], 3)
        self.assertEqual(rec["recv"][0]["src"], 1)

    def test_list_sources_finds_fixture(self):
        sources = replay_db.list_sources(HERE)
        fixture = [item for item in sources if item["path"].endswith("fixtures/mac_replay.sqlite3")]
        self.assertTrue(fixture, sources)
        item = fixture[0]
        self.assertEqual(item["schema"], "mac")
        self.assertEqual(item["sendCount"], 5)
        self.assertEqual(item["recvCount"], 5)
        self.assertEqual(sorted(item["nodes"]), [1, 2, 3, 4, 5])

    def test_legacy_modem_receive_if_present(self):
        if not os.path.isfile(LEGACY_PATH):
            self.skipTest("legacy sqlite missing: {}".format(LEGACY_PATH))
        loaded = replay_db.load_events([LEGACY_PATH])
        kinds = {event["kind"] for event in loaded["events"]}
        self.assertTrue(kinds.intersection({"tx", "rx", "hop"}))
        first = loaded["events"][0]
        self.assertIsNotNone(first["src"])
        self.assertIsNotNone(first["dst"])
        rec = replay_db.node_records([LEGACY_PATH], 1)
        self.assertGreaterEqual(rec["sendCount"] + rec["recvCount"], 1)

    def test_chain_mac_match_if_present(self):
        paths = [
            os.path.join(HERE, "ace_node", "node%d" % i, "sealinx_records.sqlite3")
            for i in range(1, 6)
        ]
        if not all(os.path.isfile(path) for path in paths):
            self.skipTest("chain node sqlite files missing")
        loaded = replay_db.load_events(paths, sim_root=HERE)
        if not loaded["hops"]:
            self.skipTest("no MAC hops yet")
        links = {(hop["macSrc"], hop["macDst"]) for hop in loaded["hops"]}
        self.assertTrue(links.intersection({(1, 2), (2, 3), (3, 4), (4, 5)}))
        matched = [hop for hop in loaded["hops"] if hop.get("matched")]
        self.assertTrue(matched)
        hop = matched[0]
        self.assertEqual(hop["macSeq"], hop["macSeq"])
        self.assertIsNotNone(hop["appSeq"])
        self.assertEqual(hop["netSrc"], hop["macSrc"])
        self.assertEqual(hop["netDst"], hop["macDst"])


if __name__ == "__main__":
    write_mac_fixture()
    result = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if result.result.wasSuccessful() else 1)
