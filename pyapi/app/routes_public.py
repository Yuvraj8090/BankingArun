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
from .capabilities import enabled_capabilities
from .rows import out
from .schemes import NIDHI_MAX_DEPOSIT_RATE, scheme_public

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


# The registered particulars, as modules/master.php states them. Kept as literals
# rather than read from a table because they are what the registrar holds: they
# change by filing a form, not by an admin editing a field.
COMPANY_IDENTITY = {
    "legal_name": "Aadhunik Jeewan Sanchay Nidhi Limited",
    "cin": "U65990UP2019PLN121746",
    "pan": "AASCA7672B",
    "tan": "MRTA12278A",
    "incorporated_on": "2019-09-27",
    "company_type": "Public company limited by shares, Nidhi under the Companies Act, 2013",
    "registered_office": "V Fatehpur Bhado, PO Chutmalpur, Saharanpur, Uttar Pradesh 247662",
    "corporate_office": "Arya Nagar, Kamalpur Road, Chhutmalpur, Saharanpur, Uttar Pradesh 247662",
    "phone": "9105015464",
    "verify_at": "https://www.mca.gov.in",
}


@router.get("/public/schemes")
def public_schemes() -> dict:
    found = rows(
        "SELECT * FROM schemes WHERE status = :status "
        "ORDER BY scheme_type, tenure_months, code",
        {"status": "active"},
    )
    return {
        "company": COMPANY_IDENTITY,
        "schemes": [scheme_public(r) for r in found],
        "max_rate_pa": NIDHI_MAX_DEPOSIT_RATE,
        "disclosure": "Returns are the amounts the scheme itself promises.",
    }


@router.get("/public/features")
def public_features() -> dict:
    """Which services may be offered at all. Carries no regulatory detail."""
    return {"features": enabled_capabilities()}


@router.get("/branches/locator")
def branches_locator() -> dict:
    """The branch and ATM network behind the public locator."""
    return {"branches": [out(r) for r in rows("SELECT * FROM branches ORDER BY id")]}
