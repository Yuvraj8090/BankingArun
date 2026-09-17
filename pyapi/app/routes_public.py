"""Public, unauthenticated routes.

First module of the port. These read nothing sensitive and change nothing, so
they are the safe place to prove the proxy, the database layer and the response
shape before anything that touches money is moved.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter

from .db import rows

router = APIRouter()


def _list(raw: Any) -> list:
    """A malformed list must not take a public page down: serve it empty."""
    try:
        value = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def product_public(r: dict) -> dict:
    return {
        "id": r["id"],
        "path": f"{r['group_key']}/{r['slug']}",
        "group": r["group_key"],
        "slug": r["slug"],
        "title": r["title"],
        "tagline": r["tagline"],
        "summary": r["summary"],
        "highlights": _list(r["highlights"]),
        "facts": _list(r["facts"]),
        "documents": _list(r["documents"]),
        "note": r["note"],
        "requires": r["requires"],
        "sort_order": int(r["sort_order"]),
        "status": r["status"],
    }


@router.get("/public/products")
def public_products() -> dict:
    found = rows(
        "SELECT * FROM site_products WHERE status = 'active' ORDER BY sort_order, title"
    )
    return {"products": [product_public(r) for r in found]}
