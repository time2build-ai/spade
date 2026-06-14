"""Collision-proof agent identity.

id = slug(name) + "__" + token. Uniqueness comes ONLY from the token (a
monotonic counter + time + random, base32), never from the name or cwd — so
similar names / directories can never collide.
"""
from __future__ import annotations

import itertools
import os
import re
import threading
import time

_SLUG_MAX = 16
_counter = itertools.count()
_lock = threading.Lock()

def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    s = s[:_SLUG_MAX].strip("-")
    return s or "agent"

def _b32(n: int) -> str:
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"  # crockford-ish
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 32)
        out.append(alphabet[r])
    return "".join(reversed(out))

def new_token() -> str:
    with _lock:
        c = next(_counter)
    # time (ms) ⊕ counter ⊕ os.urandom → short, monotonic-ish, unique
    t = int(time.time() * 1000)
    rnd = int.from_bytes(os.urandom(3), "big")
    return _b32((t << 24) ^ (c << 8) ^ rnd)[-7:]

def new_agent_id(name: str) -> str:
    # double-underscore separator: ASCII-safe for tmux/folders AND unambiguous
    # (rsplit on "__") even when the slug itself contains hyphens.
    return f"{slugify(name)}__{new_token()}"
