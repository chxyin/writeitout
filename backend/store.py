"""Persistence for WriteItOut.

Two implementations behind one small interface:

    PostgresStore  production. psycopg, one short-lived connection per call so a
                   serverless invocation never holds a pool open.
    MemoryStore    local dev, tests, and the fallback when DATABASE_URL is unset
                   or psycopg is missing. The app keeps working; it just forgets.

main.py never writes SQL: it talks to a Store. That is what keeps the database
swappable and lets the whole API run without one.

Answer text (the POI) is stored only when the deployment's mode is `full` and the
delegate has not opted out. The decision lives here, on the server, so a client
cannot talk its way past it.
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

# Hong Kong keeps UTC+8 all year, with no daylight saving, so a fixed offset is
# exact — and it spares the runtime a tzdata dependency that Windows lacks.
HK = timezone(timedelta(hours=8))
SCHEMA_FILE = Path(__file__).resolve().parent / "schema.sql"

STORAGE_MODES = ("off", "redacted", "full")
DEFAULT_STORAGE_MODE = os.getenv("POI_STORAGE_MODE", "full").strip().lower()
if DEFAULT_STORAGE_MODE not in STORAGE_MODES:
    DEFAULT_STORAGE_MODE = "full"


def today_hk() -> date:
    """The practice day in the app's own timezone, not the server's."""
    return datetime.now(HK).date()


def _redact(error: Exception) -> str:
    """A one-line reason with any credentials stripped out."""
    message = f"{type(error).__name__}: {error}"
    return re.sub(r"://[^@\s]*@", "://***@", message)[:200]


def next_streak(last: date | None, current: int, today: date) -> int:
    """Today already practised → keep; yesterday → add one; otherwise restart."""
    if last is None:
        return 1
    if last >= today:
        return max(current, 1)
    if last == today - timedelta(days=1):
        return max(current, 1) + 1
    return 1


class Store:
    """The interface main.py codes against."""

    backend = "base"

    # -- delegates ---------------------------------------------------------- #
    def upsert_delegate(self, claims: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_delegate(self, sub: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def set_store_answers(self, sub: str, enabled: bool) -> None:
        raise NotImplementedError

    # -- practice ----------------------------------------------------------- #
    def create_session(self, sub: str, reps_target: int, seconds_per_rep: int) -> str:
        raise NotImplementedError

    def session_owned_by(self, sub: str, session_id: str) -> bool:
        """True when this account owns the row. A rep is only writable into its
        own session, so one delegate cannot post into another's."""
        raise NotImplementedError

    def finish_session(
        self,
        sub: str,
        session_id: str,
        *,
        reps_done: int,
        avg_score: float | None,
        completed: bool,
        topic: str | None,
    ) -> None:
        raise NotImplementedError

    def add_rep(
        self,
        sub: str,
        session_id: str,
        *,
        rep_id: str,
        drill_id: str,
        topic: str | None,
        mode: str,
        score: float,
        timed_out: bool,
        poi: str,
        poi_chars: int,
        latency_ms: int | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        model: str | None,
    ) -> None:
        raise NotImplementedError

    def list_sessions(self, sub: str, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError

    def import_sessions(self, sub: str, entries: Iterable[dict[str, Any]]) -> int:
        raise NotImplementedError

    def profile(self, sub: str) -> dict[str, Any] | None:
        raise NotImplementedError

    # -- telemetry ---------------------------------------------------------- #
    def add_tick(self, sub: str, session_id: str | None) -> None:
        raise NotImplementedError

    def add_events(self, sub: str | None, events: list[dict[str, Any]], ip_hash: str) -> None:
        raise NotImplementedError

    # -- settings ----------------------------------------------------------- #
    def storage_mode(self) -> str:
        return DEFAULT_STORAGE_MODE

    def set_storage_mode(self, mode: str) -> None:
        raise NotImplementedError

    # -- health ------------------------------------------------------------- #
    def ping(self) -> bool:
        """True when the backing store actually answers."""
        return True

    def ping_error(self) -> str | None:
        return None

    def schema_error(self) -> str | None:
        return None

    # -- helpers ------------------------------------------------------------ #
    def should_store_answers(self, sub: str) -> bool:
        if self.storage_mode() != "full":
            return False
        delegate = self.get_delegate(sub)
        return bool(delegate and delegate.get("store_answers", True))


class MemoryStore(Store):
    """Dicts in the process. Every method matches the Postgres semantics."""

    backend = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._delegates: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, dict[str, Any]] = {}
        self._reps: dict[str, dict[str, Any]] = {}
        self._ticks: list[dict[str, Any]] = []
        self._events: list[dict[str, Any]] = []
        self._mode = DEFAULT_STORAGE_MODE

    def upsert_delegate(self, claims: dict[str, Any]) -> dict[str, Any]:
        sub = claims["sub"]
        now = datetime.now(HK)
        with self._lock:
            delegate = self._delegates.get(sub)
            if delegate is None:
                delegate = {
                    "user_sub": sub,
                    "email": claims.get("email") or None,
                    "display_name": claims.get("name") or None,
                    "picture_url": claims.get("picture") or None,
                    "store_answers": True,
                    "created_at": now,
                    "last_seen_at": now,
                    "total_reps": 0,
                    "score_sum": 0.0,
                    "best_score": None,
                    "streak_days": 0,
                    "longest_streak": 0,
                    "last_practice_on": None,
                    "total_active_seconds": 0,
                }
                self._delegates[sub] = delegate
            else:
                delegate["email"] = claims.get("email") or delegate["email"]
                delegate["display_name"] = claims.get("name") or delegate["display_name"]
                delegate["picture_url"] = claims.get("picture") or delegate["picture_url"]
                delegate["last_seen_at"] = now
            return dict(delegate)

    def get_delegate(self, sub: str) -> dict[str, Any] | None:
        with self._lock:
            delegate = self._delegates.get(sub)
            return dict(delegate) if delegate else None

    def set_store_answers(self, sub: str, enabled: bool) -> None:
        with self._lock:
            if sub in self._delegates:
                self._delegates[sub]["store_answers"] = bool(enabled)

    def create_session(self, sub: str, reps_target: int, seconds_per_rep: int) -> str:
        session_id = str(uuid.uuid4())
        with self._lock:
            self._sessions[session_id] = {
                "id": session_id,
                "user_sub": sub,
                "started_at": datetime.now(HK),
                "ended_at": None,
                "reps_target": reps_target,
                "reps_done": 0,
                "seconds_per_rep": seconds_per_rep,
                "active_seconds": 0,
                "avg_score": None,
                "completed": False,
                "topic": None,
            }
        return session_id

    def session_owned_by(self, sub: str, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
        return bool(session and session["user_sub"] == sub)

    def finish_session(
        self,
        sub: str,
        session_id: str,
        *,
        reps_done: int,
        avg_score: float | None,
        completed: bool,
        topic: str | None,
    ) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session["user_sub"] != sub:
                return
            session["reps_done"] = reps_done
            session["avg_score"] = avg_score
            session["completed"] = completed
            session["topic"] = topic
            session["ended_at"] = datetime.now(HK)

    def add_rep(
        self,
        sub: str,
        session_id: str,
        *,
        rep_id: str,
        drill_id: str,
        topic: str | None,
        mode: str,
        score: float,
        timed_out: bool,
        poi: str,
        poi_chars: int,
        latency_ms: int | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        model: str | None,
    ) -> None:
        keep_text = self.should_store_answers(sub)
        with self._lock:
            if rep_id in self._reps:
                return
            self._reps[rep_id] = {
                "id": rep_id,
                "session_id": session_id,
                "user_sub": sub,
                "drill_id": drill_id,
                "topic": topic,
                "mode": mode,
                "score": score,
                "timed_out": timed_out,
                "poi": poi if keep_text else None,
                "poi_chars": poi_chars,
                "latency_ms": latency_ms,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "model": model,
                "created_at": datetime.now(HK),
            }
            delegate = self._delegates.get(sub)
            if delegate is not None:
                delegate["total_reps"] += 1
                delegate["score_sum"] += score
                best = delegate["best_score"]
                delegate["best_score"] = score if best is None else max(best, float(score))
                today = today_hk()
                delegate["streak_days"] = next_streak(
                    delegate["last_practice_on"], delegate["streak_days"], today
                )
                delegate["longest_streak"] = max(
                    delegate["longest_streak"], delegate["streak_days"]
                )
                delegate["last_practice_on"] = today

    def list_sessions(self, sub: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = [s for s in self._sessions.values() if s["user_sub"] == sub]
        rows.sort(key=lambda s: s["started_at"], reverse=True)
        return [dict(row) for row in rows[:limit]]

    def import_sessions(self, sub: str, entries: Iterable[dict[str, Any]]) -> int:
        imported = 0
        for entry in entries:
            topic = entry.get("topic") or ""
            score = entry.get("score")
            if not isinstance(topic, str) or not isinstance(score, (int, float)):
                continue
            session_id = str(uuid.uuid4())
            with self._lock:
                self._sessions[session_id] = {
                    "id": session_id,
                    "user_sub": sub,
                    "started_at": datetime.now(HK),
                    "ended_at": datetime.now(HK),
                    "reps_target": 1,
                    "reps_done": 1,
                    "seconds_per_rep": 0,
                    "active_seconds": 0,
                    "avg_score": float(score),
                    "completed": True,
                    "topic": topic[:200],
                }
            imported += 1
        return imported

    def profile(self, sub: str) -> dict[str, Any] | None:
        with self._lock:
            delegate = self._delegates.get(sub)
            if delegate is None:
                return None
            reps = [r for r in self._reps.values() if r["user_sub"] == sub]
            ticks = [t for t in self._ticks if t["user_sub"] == sub]
            out = dict(delegate)
        total = out["total_reps"] or 0
        out["average_score"] = round(out["score_sum"] / total, 2) if total else None
        out["reps_last_7_days"] = len(
            [r for r in reps if r["created_at"] >= datetime.now(HK) - timedelta(days=7)]
        )
        out["reps_last_30_days"] = len(
            [r for r in reps if r["created_at"] >= datetime.now(HK) - timedelta(days=30)]
        )
        out["active_seconds"] = len(ticks) * 60
        return out

    def add_tick(self, sub: str, session_id: str | None) -> None:
        with self._lock:
            self._ticks.append(
                {"user_sub": sub, "session_id": session_id, "created_at": datetime.now(HK)}
            )
            delegate = self._delegates.get(sub)
            if delegate is not None:
                delegate["total_active_seconds"] += 60

    def add_events(self, sub: str | None, events: list[dict[str, Any]], ip_hash: str) -> None:
        with self._lock:
            for event in events:
                self._events.append(
                    {
                        "user_sub": sub,
                        "name": event["name"],
                        "props": event.get("props") or {},
                        "ip_hash": ip_hash,
                        "created_at": datetime.now(HK),
                    }
                )

    def storage_mode(self) -> str:
        return self._mode

    def set_storage_mode(self, mode: str) -> None:
        if mode in STORAGE_MODES:
            self._mode = mode


class PostgresStore(Store):
    """psycopg against the pooled DATABASE_URL. One connection per call."""

    backend = "postgres"

    def __init__(self, dsn: str) -> None:
        import psycopg  # noqa: PLC0415 - optional dependency, imported on use
        from psycopg.rows import dict_row  # noqa: PLC0415

        self._psycopg = psycopg
        self._dict_row = dict_row
        self.dsn = dsn
        self._migrated = False
        self._migrate_lock = threading.Lock()

    @contextmanager
    def _raw_conn(self):
        # prepare_threshold=None disables server-side prepared statements, which a
        # transaction-mode pooler (Supabase's port 6543) cannot reuse.
        with self._psycopg.connect(
            self.dsn,
            connect_timeout=10,
            row_factory=self._dict_row,
            prepare_threshold=None,
        ) as conn:
            yield conn

    @contextmanager
    def _conn(self):
        # Every query goes through here, so the tables exist before any of them
        # can fail on a fresh database. ensure_schema talks to _raw_conn to avoid
        # recursing back into this.
        self.ensure_schema()
        with self._raw_conn() as conn:
            yield conn

    def ensure_schema(self) -> None:
        if self._migrated:
            return
        with self._migrate_lock:
            if self._migrated:
                return
            sql = SCHEMA_FILE.read_text(encoding="utf-8")
            # Strip whole-line comments BEFORE splitting on ";". The schema's
            # header is prose that contains semicolons ("... account id; it is the
            # only identity key."), and splitting first cut that comment in half and
            # executed its tail.
            body = "\n".join(
                line for line in sql.splitlines() if not line.strip().startswith("--")
            )
            with self._raw_conn() as conn:
                # psycopg refuses multiple statements per execute, and the schema is
                # plain DDL, so splitting on the terminator is safe once the prose is
                # gone.
                for statement in body.split(";"):
                    statement = statement.strip()
                    if statement:
                        conn.execute(statement)
            self._migrated = True

    def upsert_delegate(self, claims: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with self._conn() as conn:
            row = conn.execute(
                """
                insert into delegates (user_sub, email, display_name, picture_url)
                values (%s, %s, %s, %s)
                on conflict (user_sub) do update set
                    email = coalesce(excluded.email, delegates.email),
                    display_name = coalesce(excluded.display_name, delegates.display_name),
                    picture_url = coalesce(excluded.picture_url, delegates.picture_url),
                    last_seen_at = now()
                returning *
                """,
                (claims["sub"], claims.get("email"), claims.get("name"), claims.get("picture")),
            ).fetchone()
        return dict(row)

    def get_delegate(self, sub: str) -> dict[str, Any] | None:
        self.ensure_schema()
        with self._conn() as conn:
            row = conn.execute("select * from delegates where user_sub = %s", (sub,)).fetchone()
        return dict(row) if row else None

    def set_store_answers(self, sub: str, enabled: bool) -> None:
        with self._conn() as conn:
            conn.execute(
                "update delegates set store_answers = %s where user_sub = %s", (enabled, sub)
            )

    def create_session(self, sub: str, reps_target: int, seconds_per_rep: int) -> str:
        session_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """
                insert into practice_sessions (id, user_sub, reps_target, seconds_per_rep)
                values (%s, %s, %s, %s)
                """,
                (session_id, sub, reps_target, seconds_per_rep),
            )
        return session_id

    def session_owned_by(self, sub: str, session_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "select 1 as ok from practice_sessions where id = %s and user_sub = %s",
                (session_id, sub),
            ).fetchone()
        return row is not None

    def finish_session(
        self,
        sub: str,
        session_id: str,
        *,
        reps_done: int,
        avg_score: float | None,
        completed: bool,
        topic: str | None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                update practice_sessions set
                    reps_done = %s, avg_score = %s, completed = %s, topic = %s, ended_at = now()
                where id = %s and user_sub = %s
                """,
                (reps_done, avg_score, completed, topic, session_id, sub),
            )

    def add_rep(
        self,
        sub: str,
        session_id: str,
        *,
        rep_id: str,
        drill_id: str,
        topic: str | None,
        mode: str,
        score: float,
        timed_out: bool,
        poi: str,
        poi_chars: int,
        latency_ms: int | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        model: str | None,
    ) -> None:
        keep_text = self.should_store_answers(sub)
        with self._conn() as conn:
            inserted = conn.execute(
                """
                insert into reps (id, session_id, user_sub, drill_id, topic, mode, score,
                                  timed_out, poi, poi_chars, latency_ms, prompt_tokens,
                                  completion_tokens, model)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do nothing
                returning id
                """,
                (
                    rep_id, session_id, sub, drill_id, topic, mode, score, timed_out,
                    poi if keep_text else None, poi_chars, latency_ms, prompt_tokens,
                    completion_tokens, model,
                ),
            ).fetchone()
            if inserted is None:
                return  # a retry of the same rep: the counters must not move twice
            conn.execute(
                """
                update delegates set
                    total_reps = total_reps + 1,
                    score_sum = score_sum + %s,
                    best_score = greatest(coalesce(best_score, 0), %s),
                    streak_days = case
                        when last_practice_on is null then 1
                        when last_practice_on >= %s then greatest(streak_days, 1)
                        when last_practice_on = %s - 1 then greatest(streak_days, 1) + 1
                        else 1
                    end,
                    longest_streak = greatest(
                        longest_streak,
                        case
                            when last_practice_on is null then 1
                            when last_practice_on >= %s then greatest(streak_days, 1)
                            when last_practice_on = %s - 1 then greatest(streak_days, 1) + 1
                            else 1
                        end
                    ),
                    last_practice_on = %s
                where user_sub = %s
                """,
                (score, score, today_hk(), today_hk(), today_hk(), today_hk(), today_hk(), sub),
            )

    def list_sessions(self, sub: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                select id, started_at, ended_at, reps_target, reps_done, avg_score,
                       completed, topic
                from practice_sessions
                where user_sub = %s
                order by started_at desc
                limit %s
                """,
                (sub, max(1, min(limit, 100))),
            ).fetchall()
        return [dict(row) for row in rows]

    def import_sessions(self, sub: str, entries: Iterable[dict[str, Any]]) -> int:
        imported = 0
        with self._conn() as conn:
            for entry in entries:
                topic = entry.get("topic")
                score = entry.get("score")
                if not isinstance(topic, str) or not isinstance(score, (int, float)):
                    continue
                conn.execute(
                    """
                    insert into practice_sessions
                        (id, user_sub, reps_target, reps_done, avg_score, completed, topic,
                         started_at, ended_at)
                    values (%s, %s, 1, 1, %s, true, %s, now(), now())
                    on conflict (id) do nothing
                    """,
                    (str(uuid.uuid4()), sub, float(score), topic[:200]),
                )
                imported += 1
        return imported

    def profile(self, sub: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            delegate = conn.execute(
                "select * from delegates where user_sub = %s", (sub,)
            ).fetchone()
            if delegate is None:
                return None
            counts = conn.execute(
                """
                select
                    count(*) filter (where created_at > now() - interval '7 days') as week,
                    count(*) filter (where created_at > now() - interval '30 days') as month
                from reps where user_sub = %s
                """,
                (sub,),
            ).fetchone()
            ticks = conn.execute(
                "select count(*) as n from activity_ticks where user_sub = %s", (sub,)
            ).fetchone()
        out = dict(delegate)
        total = out.get("total_reps") or 0
        out["average_score"] = (
            round(float(out["score_sum"]) / total, 2) if total else None
        )
        out["reps_last_7_days"] = int(counts["week"] or 0)
        out["reps_last_30_days"] = int(counts["month"] or 0)
        out["active_seconds"] = int(ticks["n"] or 0) * 60
        return out

    def add_tick(self, sub: str, session_id: str | None) -> None:
        with self._conn() as conn:
            conn.execute(
                "insert into activity_ticks (user_sub, session_id) values (%s, %s)",
                (sub, session_id),
            )
            conn.execute(
                "update delegates set total_active_seconds = total_active_seconds + 60 "
                "where user_sub = %s",
                (sub,),
            )

    def add_events(self, sub: str | None, events: list[dict[str, Any]], ip_hash: str) -> None:
        with self._conn() as conn:
            for event in events:
                conn.execute(
                    "insert into events (user_sub, name, props, ip_hash) values (%s, %s, %s, %s)",
                    (sub, event["name"], json.dumps(event.get("props") or {}), ip_hash),
                )

    def storage_mode(self) -> str:
        with self._conn() as conn:
            row = conn.execute(
                "select value from app_settings where key = 'poi_storage_mode'"
            ).fetchone()
        if row is None:
            return DEFAULT_STORAGE_MODE
        value = row["value"]
        mode = value if isinstance(value, str) else value.get("mode")
        return mode if mode in STORAGE_MODES else DEFAULT_STORAGE_MODE

    def set_storage_mode(self, mode: str) -> None:
        if mode not in STORAGE_MODES:
            raise ValueError(f"unknown storage mode: {mode}")
        with self._conn() as conn:
            conn.execute(
                """
                insert into app_settings (key, value) values ('poi_storage_mode', %s)
                on conflict (key) do update set value = excluded.value, updated_at = now()
                """,
                (json.dumps({"mode": mode}),),
            )

    def ping(self) -> bool:
        """A short, timeout-bounded probe: health must answer even when the DB is
        unreachable."""
        return self.ping_error() is None

    def ping_error(self) -> str | None:
        """Why the store cannot be reached, or None. Credentials are stripped."""
        try:
            with self._psycopg.connect(
                self.dsn,
                connect_timeout=5,
                row_factory=self._dict_row,
                prepare_threshold=None,
            ) as conn:
                conn.execute("select 1")
            return None
        except Exception as error:  # noqa: BLE001 - any failure means "not healthy"
            return _redact(error)

    def schema_error(self) -> str | None:
        """None once the tables are in place, else why they could not be created.

        The schema is applied lazily, so a deployment can be connected to Postgres
        and still be unusable until the first write. This makes that visible.
        """
        try:
            self.ensure_schema()
            return None
        except Exception as error:  # noqa: BLE001
            return _redact(error)


_store: Store | None = None
_store_lock = threading.Lock()

# The Vercel ↔ Supabase integration does not set DATABASE_URL; it injects a
# handful of POSTGRES_* names. Pooled first — serverless functions must not open a
# direct connection per invocation.
DSN_ENV_NAMES = (
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "SUPABASE_DB_URL",
)

# libpq rejects connection options it does not know. Supabase hands out URLs with
# Prisma's `pgbouncer=true` and its own `supa=base-pooler.x`; both have to go, and
# only libpq's own options are kept.
LIBPQ_PARAMS = {
    "sslmode",
    "connect_timeout",
    "application_name",
    "target_session_attrs",
    "channel_binding",
    "options",
    "keepalives",
    "keepalives_idle",
}

# Which variable the live store was built from, exposed on /api/health so a
# misconfigured deployment is obvious without reading logs.
DSN_SOURCE: str | None = None


def sanitize_dsn(dsn: str) -> str:
    """Make a Supabase/Vercel URL acceptable to libpq.

    Keeps only libpq's own parameters, and insists on TLS for a Supabase host.
    """
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    parts = urlsplit(dsn.strip())
    query = [(key, value) for key, value in parse_qsl(parts.query) if key in LIBPQ_PARAMS]
    if parts.hostname and "supabase" in parts.hostname:
        if not any(key == "sslmode" for key, _ in query):
            query.append(("sslmode", "require"))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def dsn_from_env() -> tuple[str, str | None]:
    """The first configured connection string, and the name it came from."""
    for name in DSN_ENV_NAMES:
        value = os.getenv(name, "").strip()
        if value:
            return sanitize_dsn(value), name
    return "", None


def _build_store() -> Store:
    global DSN_SOURCE
    dsn, source = dsn_from_env()
    if not dsn:
        return MemoryStore()
    try:
        store = PostgresStore(dsn)
    except ImportError:
        # A runtime without psycopg still serves the app; it just cannot remember.
        import logging

        logging.getLogger("writeitout").warning(
            "%s is set but psycopg is not installed; falling back to memory", source
        )
        return MemoryStore()
    DSN_SOURCE = source
    return store


def get_store() -> Store:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = _build_store()
    return _store


def store_source() -> str | None:
    """The environment variable the live store was built from (never its value)."""
    get_store()
    return DSN_SOURCE
