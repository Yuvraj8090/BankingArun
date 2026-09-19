"""Database access.

Every statement is parameterised. Values are never formatted into SQL — the
same rule the PHP follows with PDO, and the reason neither backend has an
injection surface.
"""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import config

_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        c = config()
        url = (
            f"mysql+pymysql://{c['db_user']}:{c['db_pass']}"
            f"@{c['db_host']}/{c['db_name']}?charset=utf8mb4"
        )
        # pre_ping so a connection the server has already dropped is replaced
        # rather than surfacing as a failed request.
        _engine = create_engine(url, pool_pre_ping=True, pool_recycle=280, future=True)
    return _engine


def rows(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    with engine().connect() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(r) for r in result.mappings()]


def row(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    found = rows(sql, params)
    return found[0] if found else None


def execute(sql: str, params: dict[str, Any] | None = None) -> int:
    """A write. Parameterised like every read; values are never formatted in."""
    with engine().begin() as conn:
        return conn.execute(text(sql), params or {}).rowcount
