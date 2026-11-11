#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映渲染调度器（Jianying Render Scheduler）

职责不是"剪"，而是"调度"：持久化任务队列、状态机、并发闸门、失败重试、产物登记。
剪辑工作交给可插拔后端：
    ffmpeg         —— 结构片（画面/字幕/转场/调色/BGM），无 GUI，可并发
    jianying-tool  —— 驱动剪映导出对话框，真渲染，VIP 素材可用，必须串行
    jy-draftc      —— 直调 videoeditor.dll 无头导出，必须串行

用法：
    python tools/jianying-scheduler/scheduler.py submit --kind ffmpeg \
        --payload tools/ffmpeg-timeline/sample.json --out output/queue/job1.mp4
    python tools/jianying-scheduler/scheduler.py run --once
    python tools/jianying-scheduler/scheduler.py status
    python tools/jianying-scheduler/scheduler.py retry --id 3
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_DB = os.path.join(HERE, "jobs.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    out_path    TEXT,
    status      TEXT NOT NULL,          -- queued|running|done|failed|canceled
    priority    INTEGER NOT NULL DEFAULT 0,
    attempts    INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER,
    output      TEXT,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, created_at);
"""


def now():
    return int(time.time())


def stamp(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "-"


def connect(path=DEFAULT_DB):
    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


# --------------------------------------------------------------------------- #
# 队列操作
# --------------------------------------------------------------------------- #

def submit(conn, kind, payload, out_path=None, priority=0, max_attempts=3):
    job_id = uuid.uuid4().hex[:12]
    conn.execute(
        "INSERT INTO jobs (id, kind, payload, out_path, status, priority, max_attempts, created_at)"
        " VALUES (?,?,?,?,'queued',?,?,?)",
        (job_id, kind, json.dumps(payload, ensure_ascii=False), out_path, priority, max_attempts, now()),
    )
    return job_id


def claim_next(conn, kinds=None):
    """原子地取一条 queued 任务并标为 running。"""
    conn.execute("BEGIN IMMEDIATE")
    try:
        sql = "SELECT * FROM jobs WHERE status='queued'"
        params = []
        if kinds:
            sql += " AND kind IN (%s)" % ",".join("?" * len(kinds))
            params += list(kinds)
        sql += " ORDER BY priority DESC, created_at ASC LIMIT 1"
        row = conn.execute(sql, params).fetchone()
        if not row:
            conn.execute("COMMIT")
            return None
        conn.execute(
            "UPDATE jobs SET status='running', attempts=attempts+1, started_at=? WHERE id=?",
            (now(), row["id"]),
        )
        conn.execute("COMMIT")
        return conn.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
    except Exception:
        conn.execute("ROLLBACK")
        raise


def finish(conn, job_id, ok, output=None, error=None):
    if ok:
        conn.execute(
            "UPDATE jobs SET status='done', output=?, error=NULL, finished_at=? WHERE id=?",
            (output, now(), job_id),
        )
        return
    row = conn.execute("SELECT attempts, max_attempts FROM jobs WHERE id=?", (job_id,)).fetchone()
    retryable = row and row["attempts"] < row["max_attempts"]
    conn.execute(
        "UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?",
        ("queued" if retryable else "failed", error, now() if not retryable else None, job_id),
    )


# --------------------------------------------------------------------------- #
# 执行
# --------------------------------------------------------------------------- #

def run_job(job, backend_root):
    sys.path.insert(0, os.path.join(HERE))
    import backends

    payload = json.loads(job["payload"])
    fn = backends.BACKENDS.get(job["kind"])
    if not fn:
        raise RuntimeError("未知后端: %s（可选: %s）" % (job["kind"], ",".join(backends.BACKENDS)))
    ctx = {
        "project_root": PROJECT_ROOT,
        "out_path": job["out_path"],
        "log": lambda msg: print("    · %s" % msg, flush=True),
    }
    return fn(payload, ctx)


def cmd_run(args):
    conn = connect(args.db)
    kinds = [k.strip() for k in args.kinds.split(",")] if args.kinds else None
    done = failed = 0
    while True:
        job = claim_next(conn, kinds)
        if not job:
            break
        print("[%s] %s %s (attempt %d/%d)" % (
            stamp(now()), job["id"], job["kind"], job["attempts"], job["max_attempts"]))
        t0 = time.time()
        try:
            output = run_job(job, PROJECT_ROOT)
            finish(conn, job["id"], True, output=output)
            done += 1
            print("    ✔ done in %.1fs → %s" % (time.time() - t0, output))
        except Exception as exc:  # noqa: BLE001
            finish(conn, job["id"], False, error=str(exc)[:2000])
            failed += 1
            row = conn.execute("SELECT status, attempts, max_attempts FROM jobs WHERE id=?",
                               (job["id"],)).fetchone()
            print("    ✘ %s (attempt %d/%d → %s)" % (
                str(exc)[:200].replace("\n", " "), row["attempts"], row["max_attempts"], row["status"]))
            if args.backoff and row["status"] == "queued":
                time.sleep(args.backoff * (2 ** (row["attempts"] - 1)))
        if args.once:
            break
    print("\n本次完成 %d 个，失败 %d 个" % (done, failed))
    return 0 if failed == 0 else 1


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def cmd_submit(args):
    conn = connect(args.db)
    with open(args.payload, encoding="utf-8-sig") as fh:
        payload = json.load(fh)
    job_id = submit(conn, args.kind, payload, out_path=args.out,
                    priority=args.priority, max_attempts=args.max_attempts)
    print(job_id)


def cmd_status(args):
    conn = connect(args.db)
    rows = conn.execute(
        "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (args.limit,)).fetchall()
    if not rows:
        print("(队列为空)")
        return 0
    print("%-14s %-16s %-9s %-3s %-20s %s" % ("ID", "KIND", "STATUS", "TRY", "FINISHED", "OUTPUT/ERROR"))
    print("-" * 110)
    for r in rows:
        tail = r["output"] or (r["error"] or "")[:60].replace("\n", " ")
        print("%-14s %-16s %-9s %-3s %-20s %s" % (
            r["id"], r["kind"], r["status"], "%d/%d" % (r["attempts"], r["max_attempts"]),
            stamp(r["finished_at"]), tail))
    counts = dict(conn.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status").fetchall())
    print("\n汇总：" + "  ".join("%s=%s" % (k, v) for k, v in sorted(counts.items())))
    return 0


def cmd_retry(args):
    conn = connect(args.db)
    conn.execute("UPDATE jobs SET status='queued', attempts=0, error=NULL WHERE id=? AND status!='running'",
                 (args.id,))
    print("已重置:", args.id)


def cmd_cancel(args):
    conn = connect(args.db)
    conn.execute("UPDATE jobs SET status='canceled' WHERE id=? AND status IN ('queued','failed')", (args.id,))
    print("已取消:", args.id)


def main():
    ap = argparse.ArgumentParser(description="剪映渲染调度器")
    ap.add_argument("--db", default=DEFAULT_DB)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("submit", help="提交任务")
    p.add_argument("--kind", required=True, help="ffmpeg | jianying-tool | jy-draftc")
    p.add_argument("--payload", required=True, help="剪辑单 / 草稿清单 JSON")
    p.add_argument("--out", default=None, help="覆盖输出路径")
    p.add_argument("--priority", type=int, default=0)
    p.add_argument("--max-attempts", type=int, default=3)
    p.set_defaults(func=cmd_submit)

    p = sub.add_parser("run", help="执行队列")
    p.add_argument("--once", action="store_true", help="只取一个任务")
    p.add_argument("--kinds", default=None, help="只跑指定后端，逗号分隔")
    p.add_argument("--backoff", type=float, default=2.0, help="重试退避基数秒")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("status", help="查看队列")
    p.add_argument("--limit", type=int, default=30)
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("retry", help="重试任务")
    p.add_argument("--id", required=True)
    p.set_defaults(func=cmd_retry)

    p = sub.add_parser("cancel", help="取消任务")
    p.add_argument("--id", required=True)
    p.set_defaults(func=cmd_cancel)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
