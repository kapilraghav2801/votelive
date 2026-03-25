# VoteLive — Low Level Design

---

## 1. Database Schema
```sql
CREATE TABLE polls (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(500) NOT NULL,
    room_key    VARCHAR(6) UNIQUE NOT NULL,
    is_blind    BOOLEAN DEFAULT FALSE,
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE options (
    id      SERIAL PRIMARY KEY,
    text    VARCHAR(255) NOT NULL,
    poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE votes (
    id        SERIAL PRIMARY KEY,
    option_id INTEGER REFERENCES options(id),
    poll_id   INTEGER REFERENCES polls(id),
    voter_id  VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(poll_id, voter_id)    -- hard duplicate prevention
);
```

**Why ON DELETE CASCADE on options and votes?**
When a poll is deleted, all its options and votes are deleted
automatically. Without this, deleting a poll would leave orphaned
rows in the options and votes tables — wasted storage and
potential data integrity issues.

---

## 2. Vote Casting — Full Code Path
```python
@router.post("/{room_key}")
async def cast_vote(room_key: str, vote: VoteCreate, db: Session):

    # Step 1 — find poll
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    if not poll:
        raise HTTPException(404, "Poll not found")

    # Step 2 — check expiry
    if datetime.utcnow() > poll.expires_at:
        raise HTTPException(400, "Poll has expired")

    # Step 3 — validate option belongs to this poll
    option = db.query(Option).filter(
        Option.id == vote.option_id,
        Option.poll_id == poll.id
    ).first()
    if not option:
        raise HTTPException(400, "Invalid option")

    # Step 4 — application-level duplicate check (fast path)
    existing = db.query(Vote).filter(
        Vote.poll_id == poll.id,
        Vote.voter_id == vote.voter_id
    ).first()
    if existing:
        raise HTTPException(400, "You have already voted")

    # Step 5 — save vote (DB constraint is final guarantee)
    db_vote = Vote(
        option_id=vote.option_id,
        poll_id=poll.id,
        voter_id=vote.voter_id
    )
    db.add(db_vote)
    db.commit()

    # Step 6 — increment Redis leaderboard
    r = get_redis()
    await r.zincrby(f"poll:{poll.id}:votes", 1, str(vote.option_id))

    # Step 7 — publish to Pub/Sub for WebSocket fan-out
    await r.publish(f"poll:{poll.id}", json.dumps({
        "option_id": vote.option_id,
        "vote_count": await r.zscore(
            f"poll:{poll.id}:votes", str(vote.option_id)
        )
    }))

    return {"status": "voted"}
```

---

## 3. Redis Leaderboard
```python
# Get live results — O(log N)
async def get_results(poll_id: int) -> list:
    r = get_redis()
    results = await r.zrevrange(
        f"poll:{poll_id}:votes", 0, -1, withscores=True
    )
    return [
        {"option_id": int(opt_id), "vote_count": int(score)}
        for opt_id, score in results
    ]
```

**Why O(log N) matters at scale:**
With 1,000 options and 1M votes, a SQL query with ORDER BY
would scan all votes and sort. Redis ZREVRANGE returns
pre-sorted results in O(log N + k) where k is the number
of results returned. For a leaderboard that updates on every
vote, this difference compounds significantly.

---

## 4. WebSocket Manager
```python
# Per-server connection registry
active_connections: dict[str, list[WebSocket]] = {}

@router.websocket("/ws/{room_key}")
async def websocket_endpoint(room_key: str, ws: WebSocket, db: Session):
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    if not poll:
        await ws.close()
        return

    await ws.accept()
    active_connections.setdefault(room_key, []).append(ws)

    try:
        # Hydrate new client with current state
        results = await get_results(poll.id)
        await ws.send_json({
            "type": "current_results",
            "leaderboard": results
        })

        # Subscribe to Redis Pub/Sub
        pubsub = get_redis().pubsub()
        await pubsub.subscribe(f"poll:{poll.id}")

        async for message in pubsub.listen():
            if message["type"] == "message":
                # Fan out to all local connections
                data = json.loads(message["data"])
                dead = []
                for conn in active_connections.get(room_key, []):
                    try:
                        await conn.send_json(data)
                    except:
                        dead.append(conn)
                for conn in dead:
                    active_connections[room_key].remove(conn)

    except WebSocketDisconnect:
        active_connections[room_key].remove(ws)
```

**Deferred removal pattern:**
Never remove from a list while iterating over it — this causes
skipped elements. Collect dead connections in a separate list,
then remove after iteration completes.

**State hydration on connect:**
When a new client connects mid-poll, they immediately receive
the current leaderboard state. Without this, late joiners would
see an empty leaderboard until the next vote comes in.

---

## 5. Lazy Redis Init — Why It Matters
```python
_redis = None

def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(os.getenv("REDIS_URL"))
    return _redis

def reset_redis():       # used in tests
    global _redis
    _redis = None
```

**Problem without lazy init:**
When FastAPI starts, Python imports all modules. If Redis
connection is created at module level, it runs at import time.
On Render free tier, the server boots cold after inactivity.
If Redis connection times out during boot, the entire app fails
to start.

**With lazy init:**
Connection created only when first Redis operation is called —
after the server is already running and responding to health checks.

**Test benefit:**
`reset_redis()` allows tests to inject a mock Redis object
without patching import-time connections.

---

## 6. Poll Expiry — DB vs Application Level
```python
# WRONG — loads all polls into Python memory, then filters
polls = db.query(Poll).all()
active = [p for p in polls if datetime.utcnow() < p.expires_at]

# CORRECT — filter at database level, only load active polls
polls = db.query(Poll).filter(
    Poll.expires_at > datetime.utcnow()
).all()
```

At 1M polls, the wrong approach loads 1M rows into Python memory
on every API call. The correct approach lets PostgreSQL use an
index on `expires_at` and return only active polls.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/polls/` | Create poll |
| GET | `/polls/{room_key}` | Get poll by room key |
| GET | `/polls/` | List active polls |
| POST | `/votes/{room_key}` | Cast vote |
| GET | `/votes/{room_key}/results` | Live leaderboard |
| WS | `/ws/{room_key}` | WebSocket updates |

---

## Interview Whiteboard Summary

1. **No signup** — 6-char room key, JWT voter token, 24hr expiry

2. **Duplicate prevention** — two layers:
   application check (fast) + DB UniqueConstraint (hard guarantee)

3. **Leaderboard** — Redis Sorted Set, O(log N) ZINCRBY + ZREVRANGE,
   atomic so no race conditions

4. **Real-time** — WebSocket + Redis Pub/Sub, supports horizontal
   scaling, state hydration on connect

5. **Blind mode** — hides results until expiry, prevents bandwagon

6. **Scale** — Redis for hot path (leaderboard), PostgreSQL for
   cold path (audit, duplicates, analytics)