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


class StatsError(RuntimeError):
    """A dashboard query failed, tagged with the section that failed.

    The dashboard is one request built from about eighteen queries, so "the
    statistics could not be read" on its own is useless to whoever has to fix
    it. The section name travels to the browser as an error code
    (`stats.habits`), which turns a screenshot into a diagnosis without the
    driver's message — which can carry the DSN — ever leaving the server.
    """

    def __init__(self, section: str):
        super().__init__(section)
        self.section = section


def today_hk() -> date:
    """The practice day in the app's own timezone, not the server's."""
    return datetime.now(HK).date()


def _redact(error: Exception) -> str:
    """A one-line reason with any credentials stripped out."""
    message = f"{type(error).__name__}: {error}"
    return re.sub(r"://[^@\s]*@", "://***@", message)[:200]


def _iso(value: Any) -> Any:
    """A datetime as an ISO string; anything else is handed back untouched."""
    return value.isoformat() if hasattr(value, "isoformat") else value


def _median(values: Iterable[float]) -> float | None:
    """The middle of a sorted copy, averaging the pair when the count is even."""
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[middle])
    return (float(ordered[middle - 1]) + float(ordered[middle])) / 2


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

    def set_session_rating(self, sub: str, session_id: str, rating: int) -> bool:
        """The completion card's tap. False when the session is not this account's
        (or no longer exists), so the caller can answer 404."""
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
        prompt_text: str | None = None,
        grade_label: str | None = None,
        reasoning: str | None = None,
        constructive_feedback: str | None = None,
        rewritten_poi: str | None = None,
        rewrite_explanation: str | None = None,
        write_ms: int | None = None,
    ) -> None:
        raise NotImplementedError

    def list_sessions(self, sub: str, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError

    def session_detail(self, sub: str, session_id: str) -> dict[str, Any] | None:
        """One session and its reps in order, or None when it is not this
        account's. The owner check is part of the query, not the caller's job."""
        raise NotImplementedError

    def import_sessions(self, sub: str, entries: Iterable[dict[str, Any]]) -> int:
        raise NotImplementedError

    def profile(self, sub: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def admin_stats(self, start: datetime, end: datetime) -> dict[str, Any]:
        """Aggregates for the developer dashboard: totals, the daily series, the
        score spread, topics, and the busiest accounts.

        Nothing here is per-answer text: the dashboard is about how the product
        is used, so it can be served whatever the answer-storage mode is.
        """
        raise NotImplementedError

    # -- admin: one delegate in detail -------------------------------------- #
    def record_ip(self, sub: str, ip: str) -> None:
        """Note that this account used this address, now."""
        raise NotImplementedError

    def admin_user(self, sub: str) -> dict[str, Any] | None:
        """One delegate in full: identity, totals and the addresses they used."""
        raise NotImplementedError

    def admin_user_reps(self, sub: str, limit: int = 300) -> list[dict[str, Any]]:
        """Everything that account has ever submitted, newest first."""
        raise NotImplementedError

    def admin_set_rep(
        self,
        rep_id: str,
        *,
        excluded: bool | None = None,
        score: float | None = None,
    ) -> dict[str, Any] | None:
        """Overwrite one run: hide it from the statistics, or change its mark.

        Either way the delegate's own totals are recounted from what is left, so
        the dashboard and the delegate's profile cannot disagree.
        """
        raise NotImplementedError

    def admin_delete_rep(self, rep_id: str) -> bool:
        """Remove one run for good. False when there was nothing to remove."""
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

    def trial_mode(self) -> bool:
        """Whether anonymous visitors are limited to a single practice."""
        return False

    def set_trial_mode(self, enabled: bool) -> None:
        raise NotImplementedError

    def claim_trial(self, visitor: str, ip: str | None) -> int:
        """Count one practice for this visitor and return how many they have had.

        1 means this was their free practice; 2 and above means the gate is shut.
        """
        raise NotImplementedError

    def trial_practices(self, visitor: str) -> int:
        """How many practices this visitor has already had (0 when unknown)."""
        return 0

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
        self._ips: dict[str, dict[str, dict[str, Any]]] = {}
        self._trials: dict[str, dict[str, Any]] = {}
        self._mode = DEFAULT_STORAGE_MODE
        self._trial = False

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
            session["topic"] = topic or session["topic"]
            session["ended_at"] = datetime.now(HK)

    def set_session_rating(self, sub: str, session_id: str, rating: int) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session["user_sub"] != sub:
                return False
            session["rating"] = int(rating)
            return True

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
        prompt_text: str | None = None,
        grade_label: str | None = None,
        reasoning: str | None = None,
        constructive_feedback: str | None = None,
        rewritten_poi: str | None = None,
        rewrite_explanation: str | None = None,
        write_ms: int | None = None,
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
                "prompt_text": prompt_text if keep_text else None,
                "grade_label": grade_label if keep_text else None,
                "reasoning": reasoning if keep_text else None,
                "constructive_feedback": constructive_feedback if keep_text else None,
                "rewritten_poi": rewritten_poi if keep_text else None,
                "rewrite_explanation": rewrite_explanation if keep_text else None,
                "latency_ms": latency_ms,
                "write_ms": write_ms,
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

    def session_detail(self, sub: str, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session["user_sub"] != sub:
                return None
            reps = [dict(r) for r in self._reps.values() if r["session_id"] == session_id]
        reps.sort(key=lambda r: r["created_at"])
        return {"session": dict(session), "reps": reps}

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

    def record_ip(self, sub: str, ip: str) -> None:
        if not ip:
            return
        with self._lock:
            seen = self._ips.setdefault(sub, {}).setdefault(
                ip, {"first_seen": datetime.now(HK), "last_seen": datetime.now(HK), "requests": 0}
            )
            seen["last_seen"] = datetime.now(HK)
            seen["requests"] += 1

    def admin_user(self, sub: str) -> dict[str, Any] | None:
        with self._lock:
            delegate = self._delegates.get(sub)
            if delegate is None:
                return None
            reps = [
                dict(r)
                for r in self._reps.values()
                if r["user_sub"] == sub and not r.get("excluded")
            ]
            ticks = [t for t in self._ticks if t["user_sub"] == sub]
            ips = {
                ip: dict(entry) for ip, entry in (self._ips.get(sub) or {}).items()
            }
        scores = [float(r["score"]) for r in reps]
        return {
            "user_sub": sub,
            "email": delegate.get("email") or "",
            "name": delegate.get("display_name") or "",
            "picture": delegate.get("picture_url") or "",
            "created_at": _iso(delegate.get("created_at")),
            "last_seen_at": _iso(delegate.get("last_seen_at")),
            "last_practice_on": _iso(delegate.get("last_practice_on")),
            "store_answers": bool(delegate.get("store_answers", True)),
            "reps": len(reps),
            "avg_score": round(sum(scores) / len(scores), 2) if scores else None,
            "best_score": (
                float(delegate["best_score"])
                if delegate.get("best_score") is not None
                else None
            ),
            "prompt_tokens": sum(int(r.get("prompt_tokens") or 0) for r in reps),
            "completion_tokens": sum(int(r.get("completion_tokens") or 0) for r in reps),
            "active_seconds": len(ticks) * 60,
            "ips": [
                {
                    "ip": ip,
                    "first_seen": _iso(entry.get("first_seen")),
                    "last_seen": _iso(entry.get("last_seen")),
                    "requests": int(entry.get("requests") or 0),
                }
                for ip, entry in sorted(
                    ips.items(), key=lambda item: item[1]["last_seen"], reverse=True
                )
            ],
        }

    def admin_user_reps(self, sub: str, limit: int = 300) -> list[dict[str, Any]]:
        with self._lock:
            reps = [dict(r) for r in self._reps.values() if r["user_sub"] == sub]
            sessions = {str(s["id"]): dict(s) for s in self._sessions.values()}
        reps.sort(key=lambda r: r["created_at"], reverse=True)
        out = []
        for rep in reps[:limit]:
            session = sessions.get(str(rep.get("session_id"))) or {}
            out.append(
                {
                    "id": str(rep.get("id") or ""),
                    "drill_id": rep.get("drill_id") or "",
                    "topic": rep.get("topic") or "",
                    "mode": rep.get("mode") or "full",
                    "score": float(rep["score"]) if rep.get("score") is not None else None,
                    "timed_out": bool(rep.get("timed_out")),
                    "created_at": _iso(rep.get("created_at")),
                    "answer": rep.get("poi") or None,
                    "answer_chars": int(rep.get("poi_chars") or 0),
                    "prompt": rep.get("prompt_text") or None,
                    "grade_label": rep.get("grade_label") or "",
                    "reasoning": rep.get("reasoning") or "",
                    "constructive_feedback": rep.get("constructive_feedback") or "",
                    "rewritten_poi": rep.get("rewritten_poi") or "",
                    "rewrite_explanation": rep.get("rewrite_explanation") or "",
                    "latency_ms": rep.get("latency_ms"),
                    "write_ms": rep.get("write_ms"),
                    "prompt_tokens": int(rep.get("prompt_tokens") or 0),
                    "completion_tokens": int(rep.get("completion_tokens") or 0),
                    "model": rep.get("model") or "",
                    "seconds_per_rep": int(session.get("seconds_per_rep") or 0),
                    "excluded": bool(rep.get("excluded")),
                    "session_completed": bool(session.get("completed")),
                }
            )
        return out

    def _recount(self, sub: str) -> None:
        with self._lock:
            delegate = self._delegates.get(sub)
            if delegate is None:
                return
            live = [
                r
                for r in self._reps.values()
                if r["user_sub"] == sub and not r.get("excluded")
            ]
            delegate["total_reps"] = len(live)
            delegate["score_sum"] = sum(float(r["score"]) for r in live)
            delegate["best_score"] = max((float(r["score"]) for r in live), default=None)

    def admin_set_rep(
        self,
        rep_id: str,
        *,
        excluded: bool | None = None,
        score: float | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            rep = self._reps.get(rep_id)
            if rep is None:
                return None
            if excluded is not None:
                rep["excluded"] = bool(excluded)
            if score is not None:
                rep["score"] = float(score)
            sub = rep["user_sub"]
            out = {
                "id": rep_id,
                "excluded": bool(rep.get("excluded")),
                "score": float(rep["score"]),
            }
        self._recount(sub)
        return out

    def admin_delete_rep(self, rep_id: str) -> bool:
        with self._lock:
            rep = self._reps.pop(rep_id, None)
            if rep is None:
                return False
            sub = rep["user_sub"]
        self._recount(sub)
        return True

    def admin_stats(self, start: datetime, end: datetime) -> dict[str, Any]:
        """Aggregates over a half-open window [start, end), Hong Kong time."""
        days = max(1, (end.date() - start.date()).days)
        now = end
        since = start
        with self._lock:
            delegates = [dict(d) for d in self._delegates.values()]
            sessions = [dict(s) for s in self._sessions.values()]
            reps = [dict(r) for r in self._reps.values()]
            ticks = [dict(t) for t in self._ticks]

        recent_reps = [
            r for r in reps if since <= r["created_at"] < end and not r.get("excluded")
        ]
        recent_sessions = [s for s in sessions if since <= s["started_at"] < end]
        recent_ticks = [t for t in ticks if since <= t["created_at"] < end]
        scores = sorted(float(r["score"]) for r in recent_reps)
        latencies = [
            int(r["latency_ms"]) for r in recent_reps if r.get("latency_ms") is not None
        ]

        def day_of(value: datetime) -> date:
            return value.astimezone(HK).date()

        daily = []
        for offset in range(days):
            day = start.date() + timedelta(days=offset)
            day_reps = [r for r in recent_reps if day_of(r["created_at"]) == day]
            day_scores = [float(r["score"]) for r in day_reps]
            day_ticks = [t for t in recent_ticks if day_of(t["created_at"]) == day]
            daily.append(
                {
                    "day": day.isoformat(),
                    "reps": len(day_reps),
                    "avg_score": round(sum(day_scores) / len(day_scores), 2) if day_scores else None,
                    "sessions": len(
                        [s for s in recent_sessions if day_of(s["started_at"]) == day]
                    ),
                    "active_users": len({t["user_sub"] for t in day_ticks}),
                    "active_seconds": len(day_ticks) * 60,
                    "prompt_tokens": sum(int(r.get("prompt_tokens") or 0) for r in day_reps),
                    "completion_tokens": sum(
                        int(r.get("completion_tokens") or 0) for r in day_reps
                    ),
                }
            )

        histogram: dict[int, int] = {}
        for score in scores:
            bucket = max(1, min(10, int(round(score))))
            histogram[bucket] = histogram.get(bucket, 0) + 1

        topic_stats: dict[str, list[float]] = {}
        for rep in recent_reps:
            topic = rep.get("topic")
            if not topic:
                continue
            topic_stats.setdefault(str(topic), []).append(float(rep["score"]))
        topics = sorted(
            (
                {
                    "topic": topic,
                    "reps": len(values),
                    "avg_score": round(sum(values) / len(values), 2),
                }
                for topic, values in topic_stats.items()
            ),
            key=lambda row: (-row["reps"], row["topic"]),
        )[:8]

        busiest = sorted(
            delegates, key=lambda d: int(d.get("total_reps") or 0), reverse=True
        )[:200]
        delegate_rows = [
            {
                "sub": str(delegate.get("user_sub") or ""),
                "email": delegate.get("email") or "",
                "name": delegate.get("display_name") or "",
                "reps": int(delegate.get("total_reps") or 0),
                "average_score": (
                    round(float(delegate["score_sum"]) / int(delegate["total_reps"]), 2)
                    if int(delegate.get("total_reps") or 0)
                    else None
                ),
                "best_score": (
                    float(delegate["best_score"])
                    if delegate.get("best_score") is not None
                    else None
                ),
                "longest_streak": int(delegate.get("longest_streak") or 0),
                "last_seen_at": _iso(delegate.get("last_seen_at")),
                "last_practice_on": _iso(delegate.get("last_practice_on")),
                "created_at": _iso(delegate.get("created_at")),
                "store_answers": bool(delegate.get("store_answers", True)),
            }
            for delegate in busiest
        ]

        # Someone counts as active on a day they had the app open, which is what
        # the heartbeat records; a window is the union of those days.
        def active_within(window_days: int) -> int:
            floor = now - timedelta(days=window_days)
            return len({t["user_sub"] for t in ticks if t["created_at"] >= floor})

        # ---- lifecycle: retention, cohorts, who has gone quiet ------------- #
        today = now.date()
        joined_on = {str(d["user_sub"]): day_of(d["created_at"]) for d in delegates}
        practice_days: dict[str, set[date]] = {}
        for rep in reps:
            practice_days.setdefault(str(rep["user_sub"]), set()).add(
                day_of(rep["created_at"])
            )

        def returned_after(offset: int) -> dict[str, Any]:
            """Share of delegates who practised exactly `offset` days later."""
            eligible = [
                sub for sub, day in joined_on.items() if (today - day).days >= offset
            ]
            hits = [
                sub
                for sub in eligible
                if any((day - joined_on[sub]).days == offset for day in practice_days.get(sub, ()))
            ]
            return {
                "rate": round(len(hits) / len(eligible), 4) if eligible else None,
                "hit": len(hits),
                "of": len(eligible),
            }

        def practised_between(sub: str, low: date, high: date) -> bool:
            return any(low <= day <= high for day in practice_days.get(sub, ()))

        cohort_buckets: dict[date, list[str]] = {}
        nine_weeks_ago = today - timedelta(weeks=9)
        for sub, day in joined_on.items():
            if day < nine_weeks_ago:
                continue
            cohort_buckets.setdefault(day - timedelta(days=day.weekday()), []).append(sub)

        cohort_rows = []
        for week in sorted(cohort_buckets):
            members = cohort_buckets[week]
            row: dict[str, Any] = {
                "week": week.isoformat(),
                "delegates": len(members),
                "w1": 0,
                "w2": 0,
                "w3": 0,
                "w4": 0,
            }
            for band in range(4):
                low = week + timedelta(days=7 * band)
                high = low + timedelta(days=6)
                row[f"w{band + 1}"] = len(
                    [sub for sub in members if practised_between(sub, low, high)]
                )
            cohort_rows.append(row)

        quiet_rows = []
        active_7 = active_14 = quiet_30 = never = 0
        for delegate in delegates:
            last = delegate.get("last_practice_on")
            if isinstance(last, datetime):
                last = last.astimezone(HK).date()
            if last is None:
                never += 1
                continue
            days_ago = (today - last).days
            if days_ago <= 7:
                active_7 += 1
            if days_ago <= 14:
                active_14 += 1
            if days_ago > 30:
                quiet_30 += 1
            if days_ago > 14:
                quiet_rows.append(
                    {
                        "email": delegate.get("email") or "",
                        "name": delegate.get("display_name") or "",
                        "reps": int(delegate.get("total_reps") or 0),
                        "last_practice_on": last.isoformat(),
                        "days_ago": days_ago,
                    }
                )
        quiet_rows.sort(key=lambda row: row["days_ago"])

        # ---- habits: how a sitting is shaped ------------------------------- #
        sessions_by_id = {str(s["id"]): s for s in sessions}
        lengths = []
        for session in recent_sessions:
            ended = session.get("ended_at")
            if ended is None:
                continue
            # Same clamp as the SQL: an unclosed tab is not a four-hour practice.
            lengths.append(
                min(max((ended - session["started_at"]).total_seconds(), 0), 14400)
            )

        dropoff_map: dict[int, int] = {}
        for session in recent_sessions:
            bucket = min(int(session.get("reps_done") or 0), 8)
            dropoff_map[bucket] = dropoff_map.get(bucket, 0) + 1

        clock_shares = []
        write_seconds = []
        for rep in recent_reps:
            write_ms = rep.get("write_ms")
            if write_ms is None:
                continue
            session = sessions_by_id.get(str(rep.get("session_id")))
            allotted = int((session or {}).get("seconds_per_rep") or 0)
            if not allotted:
                continue
            clock_shares.append(min(int(write_ms), allotted * 1000) / (allotted * 1000))
            write_seconds.append(int(write_ms) / 1000)

        def rate(part: int, whole_count: int) -> float | None:
            return round(part / whole_count, 4) if whole_count else None

        return {
            "days": days,
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
            "totals": {
                "delegates": len(delegates),
                "delegates_new": len([d for d in delegates if d["created_at"] >= since]),
                "reps_all": len(reps),
                "sessions_all": len(sessions),
                "sessions": len(recent_sessions),
                "sessions_completed": len([s for s in recent_sessions if s.get("completed")]),
                "sessions_open": len([s for s in recent_sessions if not s.get("ended_at")]),
                "reps": len(recent_reps),
                "timed_out_reps": len([r for r in recent_reps if r.get("timed_out")]),
                "single_mode_reps": len([r for r in recent_reps if r.get("mode") == "single"]),
                "avg_score": round(sum(scores) / len(scores), 2) if scores else None,
                "median_score": (
                    round(scores[len(scores) // 2], 2)
                    if len(scores) % 2
                    else round((scores[len(scores) // 2 - 1] + scores[len(scores) // 2]) / 2, 2)
                )
                if scores
                else None,
                "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
                "avg_chars": (
                    round(sum(int(r.get("poi_chars") or 0) for r in recent_reps) / len(recent_reps))
                    if recent_reps
                    else None
                ),
                "prompt_tokens": sum(int(r.get("prompt_tokens") or 0) for r in recent_reps),
                "completion_tokens": sum(
                    int(r.get("completion_tokens") or 0) for r in recent_reps
                ),
                "active_seconds": len(recent_ticks) * 60,
            },
            "active": {
                "dau": active_within(1),
                "wau": active_within(7),
                "mau": active_within(30),
            },
            # All-time by nature: a 7-day window cannot hold a 30-day read.
            "retention": {
                "d1": returned_after(1),
                "d7": returned_after(7),
                "d30": returned_after(30),
                "cohorts": cohort_rows,
            },
            "habits": {
                "sessions": len(recent_sessions),
                "finished": len([s for s in recent_sessions if s.get("completed")]),
                "timed": len([s for s in recent_sessions if int(s.get("seconds_per_rep") or 0) > 0]),
                "one_and_done": len(
                    [
                        s
                        for s in recent_sessions
                        if int(s.get("reps_done") or 0) <= 1 and not s.get("completed")
                    ]
                ),
                "rated": len([s for s in recent_sessions if s.get("rating") is not None]),
                "useful": len([s for s in recent_sessions if s.get("rating") == 1]),
                "useful_share": rate(
                    len([s for s in recent_sessions if s.get("rating") == 1]),
                    len([s for s in recent_sessions if s.get("rating") is not None]),
                ),
                "finish_rate": rate(
                    len([s for s in recent_sessions if s.get("completed")]),
                    len(recent_sessions),
                ),
                "timed_share": rate(
                    len([s for s in recent_sessions if int(s.get("seconds_per_rep") or 0) > 0]),
                    len(recent_sessions),
                ),
                "avg_session_seconds": round(sum(lengths) / len(lengths)) if lengths else None,
                "median_session_seconds": (
                    round(_median(lengths)) if lengths else None
                ),
                "avg_runs": (
                    round(
                        sum(
                            min(int(s.get("reps_done") or 0), int(s.get("reps_target") or 0))
                            for s in recent_sessions
                        )
                        / len(recent_sessions),
                        2,
                    )
                    if recent_sessions
                    else None
                ),
                "dropoff": [
                    {"runs": runs, "sessions": dropoff_map.get(runs, 0)} for runs in range(0, 9)
                ],
                "clock_measured": len(clock_shares),
                "median_clock_share": (
                    round(float(_median(clock_shares)), 4) if clock_shares else None
                ),
                "avg_write_seconds": (
                    round(sum(write_seconds) / len(write_seconds)) if write_seconds else None
                ),
            },
            "lapsed": {
                "active_7": active_7,
                "active_14": active_14,
                "quiet_14": len(quiet_rows),
                "quiet_30": quiet_30,
                "never": never,
                "delegates": quiet_rows[:8],
            },
            "daily": daily,
            # Every mark from 1 to 10, including the ones nobody scored: a spread
            # with holes in it reads as missing data rather than as a shape.
            "scores": [
                {"score": score, "reps": histogram.get(score, 0)} for score in range(1, 11)
            ],
            "topics": topics,
            "delegates": delegate_rows,
        }

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

    def trial_mode(self) -> bool:
        return self._trial

    def set_trial_mode(self, enabled: bool) -> None:
        with self._lock:
            self._trial = bool(enabled)

    def claim_trial(self, visitor: str, ip: str | None) -> int:
        with self._lock:
            row = self._trials.get(visitor)
            if row is None:
                row = {"visitor": visitor, "ip": ip, "practices": 0}
                self._trials[visitor] = row
            row["practices"] += 1
            row["ip"] = ip or row.get("ip")
            return int(row["practices"])

    def trial_practices(self, visitor: str) -> int:
        with self._lock:
            row = self._trials.get(visitor)
            return int(row["practices"]) if row else 0

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
                    reps_done = %s, avg_score = %s, completed = %s,
                    -- A close without a topic (the unload flush, an older client)
                    -- must not erase one an earlier write already stored.
                    topic = coalesce(%s, topic), ended_at = now()
                where id = %s and user_sub = %s
                """,
                (reps_done, avg_score, completed, topic, session_id, sub),
            )

    def set_session_rating(self, sub: str, session_id: str, rating: int) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                """
                update practice_sessions set rating = %s
                where id = %s and user_sub = %s
                returning id
                """,
                (int(rating), session_id, sub),
            ).fetchone()
        return row is not None

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
        prompt_text: str | None = None,
        grade_label: str | None = None,
        reasoning: str | None = None,
        constructive_feedback: str | None = None,
        rewritten_poi: str | None = None,
        rewrite_explanation: str | None = None,
        write_ms: int | None = None,
    ) -> None:
        keep_text = self.should_store_answers(sub)
        with self._conn() as conn:
            inserted = conn.execute(
                """
                insert into reps (id, session_id, user_sub, drill_id, topic, mode, score,
                                  timed_out, poi, poi_chars, prompt_text, grade_label,
                                  reasoning, constructive_feedback, rewritten_poi,
                                  rewrite_explanation, latency_ms, prompt_tokens,
                                  completion_tokens, model, write_ms)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s)
                on conflict (id) do nothing
                returning id
                """,
                (
                    rep_id, session_id, sub, drill_id, topic, mode, score, timed_out,
                    poi if keep_text else None, poi_chars,
                    prompt_text if keep_text else None,
                    grade_label if keep_text else None,
                    reasoning if keep_text else None,
                    constructive_feedback if keep_text else None,
                    rewritten_poi if keep_text else None,
                    rewrite_explanation if keep_text else None,
                    latency_ms, prompt_tokens, completion_tokens, model, write_ms,
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

    def session_detail(self, sub: str, session_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            session = conn.execute(
                """
                select id, user_sub, started_at, ended_at, reps_target, reps_done,
                       seconds_per_rep, active_seconds, avg_score, completed, topic
                from practice_sessions
                where id = %s and user_sub = %s
                """,
                (session_id, sub),
            ).fetchone()
            if session is None:
                return None
            reps = conn.execute(
                """
                select id, drill_id, topic, mode, score, timed_out, poi, poi_chars,
                       prompt_text, grade_label, reasoning, constructive_feedback,
                       rewritten_poi, rewrite_explanation, latency_ms, created_at
                from reps
                where session_id = %s and user_sub = %s
                order by created_at, id
                """,
                (session_id, sub),
            ).fetchall()
        return {"session": dict(session), "reps": [dict(row) for row in reps]}

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

    def record_ip(self, sub: str, ip: str) -> None:
        if not ip:
            return
        with self._conn() as conn:
            conn.execute(
                """
                insert into user_ips (user_sub, ip) values (%s, %s)
                on conflict (user_sub, ip) do update
                    set last_seen = now(), requests = user_ips.requests + 1
                """,
                (sub, ip),
            )

    def admin_user(self, sub: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                select user_sub, email, display_name, picture_url, store_answers,
                       created_at, last_seen_at, last_practice_on, best_score,
                       total_active_seconds
                from delegates where user_sub = %s
                """,
                (sub,),
            ).fetchone()
            if row is None:
                return None
            totals = conn.execute(
                """
                select count(*) as reps,
                       coalesce(sum(prompt_tokens), 0) as prompt_tokens,
                       coalesce(sum(completion_tokens), 0) as completion_tokens,
                       avg(score) as avg_score
                from reps where user_sub = %s
                """,
                (sub,),
            ).fetchone()
            ips = conn.execute(
                """
                select ip, first_seen, last_seen, requests from user_ips
                where user_sub = %s
                order by last_seen desc
                limit 20
                """,
                (sub,),
            ).fetchall()
        return {
            "user_sub": sub,
            "email": row.get("email") or "",
            "name": row.get("display_name") or "",
            "picture": row.get("picture_url") or "",
            "created_at": _iso(row.get("created_at")),
            "last_seen_at": _iso(row.get("last_seen_at")),
            "last_practice_on": _iso(row.get("last_practice_on")),
            "store_answers": bool(row.get("store_answers")),
            "reps": int(totals["reps"] or 0),
            "avg_score": (
                round(float(totals["avg_score"]), 2)
                if totals["avg_score"] is not None
                else None
            ),
            "best_score": (
                float(row["best_score"]) if row.get("best_score") is not None else None
            ),
            "prompt_tokens": int(totals["prompt_tokens"] or 0),
            "completion_tokens": int(totals["completion_tokens"] or 0),
            "active_seconds": int(row.get("total_active_seconds") or 0),
            "ips": [
                {
                    "ip": item["ip"],
                    "first_seen": _iso(item["first_seen"]),
                    "last_seen": _iso(item["last_seen"]),
                    "requests": int(item["requests"] or 0),
                }
                for item in ips
            ],
        }

    def admin_set_rep(
        self,
        rep_id: str,
        *,
        excluded: bool | None = None,
        score: float | None = None,
    ) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                update reps set
                    excluded = coalesce(%s, excluded),
                    score = coalesce(%s, score)
                where id = %s
                returning id, user_sub, excluded, score
                """,
                (excluded, score, rep_id),
            ).fetchone()
        if row is None:
            return None
        self.recount_delegate(row["user_sub"])
        return {
            "id": str(row["id"]),
            "excluded": bool(row["excluded"]),
            "score": float(row["score"]),
        }

    def admin_delete_rep(self, rep_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "delete from reps where id = %s returning user_sub", (rep_id,)
            ).fetchone()
        if row is None:
            return False
        self.recount_delegate(row["user_sub"])
        return True

    def recount_delegate(self, sub: str) -> None:
        """Rebuild the delegate's counters from the runs that still count."""
        with self._conn() as conn:
            conn.execute(
                """
                update delegates d set
                    total_reps = c.n,
                    score_sum = coalesce(c.total, 0),
                    best_score = c.best
                from (
                    select count(*) as n, sum(score) as total, max(score) as best
                    from reps where user_sub = %s and not excluded
                ) c
                where d.user_sub = %s
                """,
                (sub, sub),
            )

    def admin_user_reps(self, sub: str, limit: int = 300) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                select r.id, r.drill_id, r.topic, r.mode, r.score, r.timed_out,
                       r.poi, r.poi_chars, r.prompt_text, r.grade_label, r.reasoning,
                       r.constructive_feedback, r.rewritten_poi, r.rewrite_explanation,
                       r.latency_ms, r.write_ms, r.prompt_tokens, r.completion_tokens,
                       r.model, r.created_at,
                       coalesce(s.seconds_per_rep, 0) as seconds_per_rep,
                       coalesce(s.completed, false) as session_completed, r.excluded
                from reps r
                left join practice_sessions s on s.id = r.session_id
                where r.user_sub = %s
                order by r.created_at desc
                limit %s
                """,
                (sub, max(1, min(1000, int(limit)))),
            ).fetchall()
        return [
            {
                "id": str(row.get("id") or ""),
                "drill_id": row.get("drill_id") or "",
                "topic": row.get("topic") or "",
                "mode": row.get("mode") or "full",
                "score": float(row["score"]) if row.get("score") is not None else None,
                "timed_out": bool(row.get("timed_out")),
                "created_at": _iso(row.get("created_at")),
                "answer": row.get("poi") or None,
                "answer_chars": int(row.get("poi_chars") or 0),
                "prompt": row.get("prompt_text") or None,
                "grade_label": row.get("grade_label") or "",
                "reasoning": row.get("reasoning") or "",
                "constructive_feedback": row.get("constructive_feedback") or "",
                "rewritten_poi": row.get("rewritten_poi") or "",
                "rewrite_explanation": row.get("rewrite_explanation") or "",
                "latency_ms": row.get("latency_ms"),
                "write_ms": row.get("write_ms"),
                "prompt_tokens": int(row.get("prompt_tokens") or 0),
                "completion_tokens": int(row.get("completion_tokens") or 0),
                "model": row.get("model") or "",
                "seconds_per_rep": int(row.get("seconds_per_rep") or 0),
                "excluded": bool(row.get("excluded")),
                "session_completed": bool(row.get("session_completed")),
            }
            for row in rows
        ]

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

    def admin_stats(self, start: datetime, end: datetime) -> dict[str, Any]:
        """Aggregates over a half-open window [start, end), Hong Kong time."""
        hk_day = "(created_at at time zone 'Asia/Hong_Kong')::date"
        started_day = "(started_at at time zone 'Asia/Hong_Kong')::date"
        days = max(1, (end.date() - start.date()).days)

        def number(value: Any) -> float | None:
            """numeric comes back as Decimal; the JSON layer wants a float."""
            return float(value) if value is not None else None

        def whole(value: Any) -> int:
            return int(value or 0)

        with self._conn() as conn:
            def run(section: str, sql: str, params: Any = None) -> Any:
                """One query, tagged so a failure names the section that broke."""
                try:
                    return conn.execute(sql) if params is None else conn.execute(sql, params)
                except Exception as error:  # noqa: BLE001 - re-raised with a section
                    raise StatsError(section) from error

            totals = run("totals",
                f"""
                select
                    (select count(*) from delegates) as delegates,
                    (select count(*) from delegates where created_at >= %s and created_at < %s)
                        as delegates_new,
                    (select count(*) from reps) as reps_all,
                    (select count(*) from practice_sessions) as sessions_all
                """,
                (start, end),
            ).fetchone()

            activity = run("activity",
                """
                select
                    count(distinct user_sub) filter (
                        where created_at > now() - interval '1 day'
                    ) as dau,
                    count(distinct user_sub) filter (
                        where created_at > now() - interval '7 days'
                    ) as wau,
                    count(distinct user_sub) filter (
                        where created_at > now() - interval '30 days'
                    ) as mau
                from activity_ticks
                """
            ).fetchone()

            reps = run("reps",
                f"""
                select
                    count(*) as reps,
                    count(*) filter (where timed_out) as timed_out_reps,
                    count(*) filter (where mode = 'single') as single_mode_reps,
                    avg(score) as avg_score,
                    percentile_cont(0.5) within group (order by score::float8) as median_score,
                    avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms,
                    avg(poi_chars) as avg_chars,
                    coalesce(sum(prompt_tokens), 0) as prompt_tokens,
                    coalesce(sum(completion_tokens), 0) as completion_tokens
                from reps
                where created_at >= %s and created_at < %s and not excluded
                """,
                (start, end),
            ).fetchone()

            sessions = run("sessions",
                f"""
                select
                    count(*) as sessions,
                    count(*) filter (where completed) as sessions_completed,
                    count(*) filter (where ended_at is null) as sessions_open
                from practice_sessions
                where started_at >= %s and started_at < %s
                """,
                (start, end),
            ).fetchone()

            ticks = run("ticks",
                f"select count(*) as ticks from activity_ticks where created_at >= %s and created_at < %s",
                (start, end),
            ).fetchone()

            # The daily series: three grouped queries, merged below, rather than
            # one query with three left joins that would fan out the counts.
            daily_reps = run("daily_reps",
                f"""
                select {hk_day} as day,
                       count(*) as reps,
                       avg(score) as avg_score,
                       coalesce(sum(prompt_tokens), 0) as prompt_tokens,
                       coalesce(sum(completion_tokens), 0) as completion_tokens
                from reps
                where created_at >= %s and created_at < %s and not excluded
                group by 1
                """,
                (start, end),
            ).fetchall()

            daily_sessions = run("daily_sessions",
                f"""
                select {started_day} as day, count(*) as sessions
                from practice_sessions
                where started_at >= %s and started_at < %s
                group by 1
                """,
                (start, end),
            ).fetchall()

            daily_ticks = run("daily_ticks",
                f"""
                select {hk_day} as day,
                       count(distinct user_sub) as active_users,
                       count(*) as ticks
                from activity_ticks
                where created_at >= %s and created_at < %s
                group by 1
                """,
                (start, end),
            ).fetchall()

            histogram = {
                int(row["score"]): whole(row["reps"])
                for row in run("histogram",
                    f"""
                    select greatest(1, least(10, round(score)::int)) as score,
                           count(*) as reps
                    from reps
                    where created_at >= %s and created_at < %s and not excluded
                    group by 1
                    """,
                    (start, end),
                ).fetchall()
            }

            topics = run("topics",
                f"""
                select topic, count(*) as reps, avg(score) as avg_score
                from reps
                where created_at >= %s and created_at < %s and not excluded and topic is not null
                group by 1
                order by reps desc, topic
                limit 8
                """,
                (start, end),
            ).fetchall()

            busiest = run("delegates",
                """
                select user_sub, email, display_name, total_reps, score_sum, best_score,
                       longest_streak, last_seen_at, last_practice_on, created_at,
                       store_answers
                from delegates
                order by total_reps desc, last_seen_at desc
                limit 200
                """
            ).fetchall()

            # Retention. A delegate "came back on day N" when they had a run
            # exactly N Hong Kong days after the day they first signed in — the
            # usual D1/D7/D30 read. A signup that has not yet had those days is
            # left out of the denominator instead of being counted as lost.
            retention = run("retention",
                """
                with joined as (
                    select user_sub, (created_at at time zone 'Asia/Hong_Kong')::date as day
                    from delegates
                ),
                marks as (
                    select j.user_sub, j.day,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   - j.day = 1) as d1,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   - j.day = 7) as d7,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   - j.day = 30) as d30
                    from joined j left join reps r on r.user_sub = j.user_sub
                    group by j.user_sub, j.day
                )
                select
                    count(*) filter (where day <= current_date - 1) as n1,
                    count(*) filter (where day <= current_date - 1 and d1) as r1,
                    count(*) filter (where day <= current_date - 7) as n7,
                    count(*) filter (where day <= current_date - 7 and d7) as r7,
                    count(*) filter (where day <= current_date - 30) as n30,
                    count(*) filter (where day <= current_date - 30 and d30) as r30
                from marks
                """
            ).fetchone()

            # Cohorts: everyone who joined in the same week, and how many of them
            # were back in each of the following four weeks. This is the habit
            # question the totals cannot answer — "do new delegates come back".
            cohorts = run("cohorts",
                """
                with joined as (
                    select user_sub,
                           date_trunc('week', created_at at time zone 'Asia/Hong_Kong')::date
                               as week
                    from delegates
                    where created_at > now() - interval '9 weeks'
                ),
                marks as (
                    select j.user_sub, j.week,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   between j.week and j.week + 6) as w1,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   between j.week + 7 and j.week + 13) as w2,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   between j.week + 14 and j.week + 20) as w3,
                           bool_or((r.created_at at time zone 'Asia/Hong_Kong')::date
                                   between j.week + 21 and j.week + 27) as w4
                    from joined j left join reps r on r.user_sub = j.user_sub
                    group by j.user_sub, j.week
                )
                select week,
                       count(*) as delegates,
                       count(*) filter (where w1) as w1,
                       count(*) filter (where w2) as w2,
                       count(*) filter (where w3) as w3,
                       count(*) filter (where w4) as w4
                from marks
                group by week
                order by week
                """
            ).fetchall()

            # Who has gone quiet. `never` is a signed-in account with no graded
            # run at all — a different problem from a delegate who stopped.
            lapsed_counts = run("lapsed_counts",
                """
                select
                    count(*) filter (where last_practice_on >= current_date - 7)
                        as active_7,
                    count(*) filter (where last_practice_on >= current_date - 14)
                        as active_14,
                    count(*) filter (where last_practice_on is not null
                                     and last_practice_on < current_date - 14)
                        as quiet_14,
                    count(*) filter (where last_practice_on is not null
                                     and last_practice_on < current_date - 30)
                        as quiet_30,
                    count(*) filter (where last_practice_on is null) as never
                from delegates
                """
            ).fetchone()

            lapsed = run("lapsed",
                """
                select email, display_name, total_reps, last_practice_on,
                       (current_date - last_practice_on) as days_ago
                from delegates
                where last_practice_on is not null and last_practice_on < current_date - 14
                order by last_practice_on desc
                limit 8
                """
            ).fetchall()

            # How a sitting is actually shaped: how long, how many runs, and how
            # often the delegate walked away before the last run. A session that
            # was never closed is left out of the length averages — its end time is
            # the moment the tab was next opened, not a practice duration — and one
            # left open overnight is capped at four hours for the same reason.
            habits = run("habits",
                f"""
                select
                    count(*) as sessions,
                    count(*) filter (where completed) as finished,
                    count(*) filter (where seconds_per_rep > 0) as timed,
                    count(*) filter (where reps_done <= 1 and not completed) as one_and_done,
                    count(*) filter (where rating is not null) as rated,
                    count(*) filter (where rating = 1) as useful,
                    avg(case when ended_at is not null then
                        least(greatest(extract(epoch from (ended_at - started_at)), 0), 14400)
                    end) as avg_seconds,
                    percentile_cont(0.5) within group (
                        order by case when ended_at is not null then
                            least(greatest(extract(epoch from (ended_at - started_at)), 0), 14400)
                        end
                    ) as median_seconds,
                    avg(least(reps_done, reps_target)) as avg_runs
                from practice_sessions
                where started_at >= %s and started_at < %s
                """,
                (start, end),
            ).fetchone()

            # Where the run count lands, bucketed at 8+: the drop-off shape.
            dropoff = run("dropoff",
                f"""
                select least(reps_done, 8) as runs, count(*) as sessions
                from practice_sessions
                where started_at >= %s and started_at < %s
                group by 1
                """,
                (start, end),
            ).fetchall()

            # How much of the clock the delegate used, for runs that had a clock
            # and a recorded writing time. The median is the honest number: one
            # run submitted after a coffee break would drag an average.
            clock = run("clock",
                f"""
                select
                    count(*) as measured,
                    percentile_cont(0.5) within group (
                        order by least(r.write_ms, s.seconds_per_rep * 1000)::float8
                                 / (s.seconds_per_rep * 1000)
                    ) as median_share,
                    avg(r.write_ms) / 1000.0 as avg_seconds
                from reps r join practice_sessions s on s.id = r.session_id
                where r.created_at >= %s and r.created_at < %s and not r.excluded
                  and r.write_ms is not null
                  and s.seconds_per_rep > 0
                """,
                (start, end),
            ).fetchone()

        by_day = {row["day"]: row for row in daily_reps}
        sessions_by_day = {row["day"]: row for row in daily_sessions}
        ticks_by_day = {row["day"]: row for row in daily_ticks}

        # The series covers every Hong Kong day the window touches, so a custom
        # range that starts at lunchtime still shows the shape of its first day.
        daily = []
        for offset in range(days):
            day = start.date() + timedelta(days=offset)
            rep_row = by_day.get(day) or {}
            session_row = sessions_by_day.get(day) or {}
            tick_row = ticks_by_day.get(day) or {}
            daily.append(
                {
                    "day": day.isoformat(),
                    "reps": whole(rep_row.get("reps")),
                    "avg_score": (
                        round(float(rep_row["avg_score"]), 2)
                        if rep_row.get("avg_score") is not None
                        else None
                    ),
                    "sessions": whole(session_row.get("sessions")),
                    "active_users": whole(tick_row.get("active_users")),
                    "active_seconds": whole(tick_row.get("ticks")) * 60,
                    "prompt_tokens": whole(rep_row.get("prompt_tokens")),
                    "completion_tokens": whole(rep_row.get("completion_tokens")),
                }
            )

        delegate_rows = []
        for row in busiest:
            total = whole(row.get("total_reps"))
            delegate_rows.append(
                {
                    "sub": str(row.get("user_sub") or ""),
                    "email": row.get("email") or "",
                    "name": row.get("display_name") or "",
                    "reps": total,
                    "average_score": (
                        round(float(row["score_sum"]) / total, 2)
                        if total and row.get("score_sum") is not None
                        else None
                    ),
                    "best_score": number(row.get("best_score")),
                    "longest_streak": whole(row.get("longest_streak")),
                    "last_seen_at": _iso(row.get("last_seen_at")),
                    "last_practice_on": _iso(row.get("last_practice_on")),
                    "created_at": _iso(row.get("created_at")),
                    "store_answers": bool(row.get("store_answers", True)),
                }
            )

        def share(hit: Any, of: Any) -> float | None:
            """A rate with an empty denominator stays null, never 0.0."""
            total = whole(of)
            return round(whole(hit) / total, 4) if total else None

        def seconds(value: Any) -> int | None:
            return int(round(float(value))) if value is not None else None

        dropoff_map = {int(row["runs"]): whole(row["sessions"]) for row in dropoff}
        cohort_rows = [
            {
                "week": row["week"].isoformat() if hasattr(row["week"], "isoformat") else str(row["week"]),
                "delegates": whole(row["delegates"]),
                "w1": whole(row["w1"]),
                "w2": whole(row["w2"]),
                "w3": whole(row["w3"]),
                "w4": whole(row["w4"]),
            }
            for row in cohorts
        ]

        return {
            "days": days,
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
            "totals": {
                "delegates": whole(totals["delegates"]),
                "delegates_new": whole(totals["delegates_new"]),
                "reps_all": whole(totals["reps_all"]),
                "sessions_all": whole(totals["sessions_all"]),
                "sessions": whole(sessions["sessions"]),
                "sessions_completed": whole(sessions["sessions_completed"]),
                "sessions_open": whole(sessions["sessions_open"]),
                "reps": whole(reps["reps"]),
                "timed_out_reps": whole(reps["timed_out_reps"]),
                "single_mode_reps": whole(reps["single_mode_reps"]),
                "avg_score": (
                    round(float(reps["avg_score"]), 2)
                    if reps["avg_score"] is not None
                    else None
                ),
                "median_score": number(reps["median_score"]),
                "avg_latency_ms": (
                    round(float(reps["avg_latency_ms"]))
                    if reps["avg_latency_ms"] is not None
                    else None
                ),
                "avg_chars": seconds(reps["avg_chars"]),
                "prompt_tokens": whole(reps["prompt_tokens"]),
                "completion_tokens": whole(reps["completion_tokens"]),
                "active_seconds": whole(ticks["ticks"]) * 60,
            },
            "active": {
                "dau": whole(activity["dau"]),
                "wau": whole(activity["wau"]),
                "mau": whole(activity["mau"]),
            },
            # Retention is all-time by nature: a 7-day window cannot hold a
            # 30-day read, so these numbers ignore the picker and say so on screen.
            "retention": {
                "d1": {"rate": share(retention["r1"], retention["n1"]),
                       "hit": whole(retention["r1"]), "of": whole(retention["n1"])},
                "d7": {"rate": share(retention["r7"], retention["n7"]),
                       "hit": whole(retention["r7"]), "of": whole(retention["n7"])},
                "d30": {"rate": share(retention["r30"], retention["n30"]),
                        "hit": whole(retention["r30"]), "of": whole(retention["n30"])},
                "cohorts": cohort_rows,
            },
            "habits": {
                "sessions": whole(habits["sessions"]),
                "finished": whole(habits["finished"]),
                "timed": whole(habits["timed"]),
                "one_and_done": whole(habits["one_and_done"]),
                # The completion card's tap, which is the only direct signal that
                # the chair's feedback helped rather than merely got a number.
                "rated": whole(habits["rated"]),
                "useful": whole(habits["useful"]),
                "useful_share": share(habits["useful"], habits["rated"]),
                "finish_rate": share(habits["finished"], habits["sessions"]),
                "timed_share": share(habits["timed"], habits["sessions"]),
                "avg_session_seconds": seconds(habits["avg_seconds"]),
                "median_session_seconds": seconds(habits["median_seconds"]),
                "avg_runs": number(habits["avg_runs"]),
                "dropoff": [
                    {"runs": runs, "sessions": dropoff_map.get(runs, 0)}
                    for runs in range(0, 9)
                ],
                # Time against the clock, for runs that actually had one.
                "clock_measured": whole(clock["measured"]),
                "median_clock_share": number(clock["median_share"]),
                "avg_write_seconds": seconds(clock["avg_seconds"]),
            },
            "lapsed": {
                "active_7": whole(lapsed_counts["active_7"]),
                "active_14": whole(lapsed_counts["active_14"]),
                "quiet_14": whole(lapsed_counts["quiet_14"]),
                "quiet_30": whole(lapsed_counts["quiet_30"]),
                "never": whole(lapsed_counts["never"]),
                "delegates": [
                    {
                        "email": row.get("email") or "",
                        "name": row.get("display_name") or "",
                        "reps": whole(row.get("total_reps")),
                        "last_practice_on": _iso(row.get("last_practice_on")),
                        "days_ago": whole(row.get("days_ago")),
                    }
                    for row in lapsed
                ],
            },
            "daily": daily,
            # Every mark from 1 to 10, including the ones nobody scored: a spread
            # with holes in it reads as missing data rather than as a shape.
            "scores": [
                {"score": score, "reps": histogram.get(score, 0)} for score in range(1, 11)
            ],
            "topics": [
                {
                    "topic": row["topic"],
                    "reps": whole(row["reps"]),
                    "avg_score": round(float(row["avg_score"]), 2),
                }
                for row in topics
            ],
            "delegates": delegate_rows,
        }

    def add_events(self, sub: str | None, events: list[dict[str, Any]], ip_hash: str) -> None:
        with self._conn() as conn:
            for event in events:
                conn.execute(
                    "insert into events (user_sub, name, props, ip_hash) values (%s, %s, %s, %s)",
                    (sub, event["name"], json.dumps(event.get("props") or {}), ip_hash),
                )

    def trial_mode(self) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "select value from app_settings where key = 'poi_trial_mode'"
            ).fetchone()
        if row is None:
            return False
        value = row["value"]
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "on", "yes")
        return bool(value.get("enabled")) if isinstance(value, dict) else False

    def set_trial_mode(self, enabled: bool) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                insert into app_settings (key, value) values ('poi_trial_mode', %s::jsonb)
                on conflict (key) do update
                    set value = excluded.value, updated_at = now()
                """,
                (json.dumps(bool(enabled)),),
            )

    def claim_trial(self, visitor: str, ip: str | None) -> int:
        with self._conn() as conn:
            row = conn.execute(
                """
                insert into trial_visits (visitor, ip, practices) values (%s, %s, 1)
                on conflict (visitor) do update
                    set practices = trial_visits.practices + 1,
                        ip = coalesce(excluded.ip, trial_visits.ip),
                        last_seen = now()
                returning practices
                """,
                (visitor, ip),
            ).fetchone()
        return int(row["practices"]) if row else 0

    def trial_practices(self, visitor: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "select practices from trial_visits where visitor = %s", (visitor,)
            ).fetchone()
        return int(row["practices"]) if row else 0

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
