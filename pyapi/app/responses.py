"""Response shapes, matching the PHP byte for byte.

The React app reads {"detail": "..."} on failure — FastAPI's own shape, which
the PHP was written to imitate. Keeping it means a ported route needs no
frontend change.
"""
from __future__ import annotations

from fastapi import HTTPException


def fail(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)
