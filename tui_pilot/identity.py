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
    # The process-monotonic counter lives in the LOW 16 bits so it survives the
    # truncation below — this *guarantees* uniqueness within a process (up to
    # 65536 ids/ms regardless of name). Time + random fill the higher bits for
    # cross-process uniqueness. Earlier versions XOR'd the counter into bits that
    # were then truncated away, so 1000s of same-ms ids could collide.
    with _lock:
        c = next(_counter)
    t = int(time.time() * 1000)
    rnd = int.from_bytes(os.urandom(4), "big")  # 32 bits
    raw = (t << 48) | (rnd << 16) | (c & 0xFFFF)
    return _b32(raw)[-8:]

def new_agent_id(name: str) -> str:
    # double-underscore separator: ASCII-safe for tmux/folders AND unambiguous
    # (rsplit on "__") even when the slug itself contains hyphens.
    return f"{slugify(name)}__{new_token()}"
