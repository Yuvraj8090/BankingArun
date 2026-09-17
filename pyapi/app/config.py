"""Configuration, read from the same file the PHP backend uses.

Both backends must agree on the token secret and the database, or a session
minted by one is rejected by the other. Rather than keep a second copy that can
drift, the PHP config is exported to JSON at deploy time — by PHP itself, which
is the only thing that can reliably parse a PHP array.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

CONFIG_JSON = Path(os.environ.get("AJSPAY_CONFIG", "/etc/ajspay/config.json"))

DEFAULTS = {
    "db_host": "127.0.0.1",
    "db_name": "ajspay",
    "db_user": "ajspay",
    "db_pass": "",
    "token_secret": "",
    "cookie_secure": True,
    "token_ttl": 28800,
    "allowed_origins": [],
}


@lru_cache(maxsize=1)
def config() -> dict:
    if not CONFIG_JSON.is_file():
        raise RuntimeError(
            f"{CONFIG_JSON} is missing. It is generated from the PHP config at deploy time; "
            "without it this service cannot verify sessions the PHP backend issued."
        )
    loaded = json.loads(CONFIG_JSON.read_text())
    merged = {**DEFAULTS, **loaded}
    # The same refusal the PHP makes: an unsigned session is worse than no service.
    if not merged["token_secret"]:
        raise RuntimeError("token_secret is not set; refusing to start.")
    return merged
