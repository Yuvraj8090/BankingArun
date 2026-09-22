"""AJSPay API — the Python port.

Runs alongside the PHP backend rather than replacing it. Apache proxies only
the paths listed as ported; everything else continues to reach api.php. Both
read the same MariaDB and verify the same session tokens, so a member never
notices which one served a request.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from . import routes_public, routes_rails
from .impersonation import block_impersonated_writes
from .ratelimit import guard_request

log = logging.getLogger("ajspay")

app = FastAPI(title="AJSPay API", docs_url=None, redoc_url=None, openapi_url=None)

# The API is same-origin behind Apache, so no CORS middleware is added: the
# PHP's allowed_origins list exists for the same reason and stays authoritative.

# A support session may read but never write. Registered as middleware, not as a
# dependency, for the reason the PHP checks it in its dispatcher: a route that
# forgets the dependency would silently accept the write. See impersonation.py.
app.middleware("http")(block_impersonated_writes)

# Rate limiting, added after the guard above and therefore wrapping it: the last
# middleware registered is the outermost, and the PHP counts the request before
# it decides anything else about it -- including before rejecting an unknown
# path, so probing costs what using it costs.
app.middleware("http")(guard_request)

app.include_router(routes_public.router, prefix="/api")
# The owner's payment-rail screen. Settlement stays in the PHP; see rails.py.
app.include_router(routes_rails.router, prefix="/api")


@app.exception_handler(SQLAlchemyError)
def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """The PHP's wording, and nothing else.

    A driver exception carries the host, the user and often the statement. It
    belongs in the log, never in a response a member can read.
    """
    log.exception("database error on %s", request.url.path)
    return JSONResponse({"detail": "Database connection failed. Please try again later."}, status_code=500)


@app.exception_handler(Exception)
def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


@app.get("/api/_py/health")
def health() -> JSONResponse:
    """Liveness only. Deliberately reveals no version or configuration."""
    return JSONResponse({"status": "ok"})
