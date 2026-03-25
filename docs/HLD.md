# VoteLive — High Level Design

## Problem Statement

Small groups waste 15+ minutes on simple decisions — what to eat,
which feature to build next, where to go. Existing tools require
signup, are too heavy, or don't show live results. VoteLive gives
groups a real-time anonymous decision in under 60 seconds with
zero friction.

---

## Scale Targets (Design Exercise)

| Metric | Target |
|---|---|
| Concurrent polls | 10,000 |
| Voters per poll | 1,000 |
| Vote throughput | 5,000 votes/second |
| Leaderboard latency | < 50ms |
| WebSocket fan-out | < 100ms |

---

## High Level Architecture
```
                    ┌─────────────────┐
                    │   Client        │
                    │ (React + Vite)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Vercel CDN    │
                    │  (Static Files) │
                    └────────┬────────┘
                             │
               ┌─────────────▼──────────────┐
               │        FastAPI              │
               │     (Render.com)            │
               │                            │
               │  POST /votes/{room_key}     │
               │  GET  /votes/{room_key}/results
               │  WS   /ws/{room_key}        │
               └────────────────────────────┘
                    │              │
          ┌─────────▼────┐  ┌─────▼──────────┐
          │  PostgreSQL   │  │     Redis       │
          │   (Neon)      │  │   (Upstash)     │
          │               │  │                 │
          │ votes table   │  │ Sorted Sets     │
          │ polls table   │  │ Pub/Sub         │
          │ options table │  │                 │
          └───────────────┘  └─────────────────┘
```

---

## Core Components

### 1. Poll Service
Creates polls with a 6-character room key, configurable duration,
and optional blind mode. Filters expired polls at database level
using `expires_at` datetime comparison — not in Python application
code, which would require loading all polls into memory first.

### 2. Vote Service — Two Storage Layers

**PostgreSQL** — source of truth.
Stores every individual vote with a UniqueConstraint on
(poll_id, voter_id). Provides audit trail and hard duplicate
prevention guarantee.

**Redis Sorted Set** — real-time leaderboard.
Stores only vote counts per option. ZINCRBY atomically increments
on every vote. ZREVRANGE returns ranked results in O(log N).
If Redis is lost, counts can be recomputed from PostgreSQL.

### 3. WebSocket Fan-out with Pub/Sub
```
Voter casts vote
    │
    ▼
FastAPI server receives
    │
    ├── PostgreSQL: save vote + check duplicate
    ├── Redis: ZINCRBY option score
    └── Redis Pub/Sub: publish to channel poll:{id}
              │
              ▼
    All subscribed server instances receive
              │
              ▼
    Each server broadcasts to local WebSocket connections
              │
              ▼
    All connected browsers update leaderboard < 100ms
```

This architecture supports horizontal scaling — multiple API server
instances all subscribe to the same Redis Pub/Sub channel, so
every voter sees every update regardless of which server they hit.

### 4. Blind Mode

When `is_blind=True`, the leaderboard is hidden from voters until
the poll expires. This prevents the bandwagon effect where early
results influence later voters. Frontend checks `is_blind` and
`expires_at` before rendering results.

---

## Key Tradeoffs

### PostgreSQL + Redis vs Redis only

Could store everything in Redis. Chose PostgreSQL + Redis because:
- PostgreSQL gives ACID guarantees for vote integrity
- UniqueConstraint is a hard database-level duplicate prevention
- Redis data is volatile — restart loses all vote counts
- PostgreSQL enables analytics queries Redis cannot serve

### JWT voter tokens vs session cookies

Chose JWT because:
- Stateless — no session store needed
- Works across browser tabs
- 24-hour expiry prevents permanent duplicate blocking

### Room key collision
```python
def generate_room_key() -> str:
    while True:
        key = ''.join(random.choices(string.ascii_lowercase, k=6))
        existing = db.query(Poll).filter(Poll.room_key == key).first()
        if not existing:
            return key
```

26^6 = 308 million possible keys. At 10,000 active polls,
collision probability is ~0.003%. While-loop with collision
check guarantees uniqueness without UUID complexity.

---

## What production would add

- IP-based rate limiting (third layer after app + DB duplicate check)
- Blind mode enforcement at Redis level (hide key until expiry)
- Poll analytics dashboard (votes over time, peak voter time)
- Webhook notifications when poll closes
- Redis AOF persistence so counts survive restarts