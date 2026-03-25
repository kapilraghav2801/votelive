# VoteLive — Backend

Real-time anonymous voting API built with FastAPI, PostgreSQL, and Redis.

**API Docs:** `http://localhost:8000/docs`

---

## What this does

VoteLive lets small groups make decisions in real-time — no signup, no friction.
Someone creates a poll, shares a 6-character room key, and everyone votes live.

Core problems solved:
- **No duplicate votes** — enforced at both application and database level
- **Real-time updates** — WebSocket broadcasts every vote instantly to all viewers
- **Fast leaderboard** — Redis Sorted Sets return rankings in O(log N)
- **Fair results** — blind mode hides results until poll closes

---

## Architecture
```
votelive/backend/
├── main.py           # App entry point — registers routers, CORS, DB init
├── database.py       # SQLAlchemy engine, session factory, get_db dependency
├── models.py         # Database tables — Poll, Option, Vote
├── schemas.py        # Pydantic schemas — request validation + response shapes
├── auth.py           # Room key generation, JWT creation, poll expiry check
├── requirements.txt  # Dependencies
├── .env              # Environment variables (never commit this)
└── routers/
    ├── polls.py      # Create poll, get by room key, list active polls
    ├── votes.py      # Cast vote, get leaderboard from Redis
    └── websocket.py  # WebSocket — live vote broadcast via Redis Pub/Sub
```

---

## API Endpoints

### Polls
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/polls/` | Create a new poll with options |
| GET | `/polls/{room_key}` | Get poll by room key |
| GET | `/polls/` | List all active (non-expired) polls |

### Votes
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/votes/{room_key}` | Cast a vote |
| GET | `/votes/{room_key}/results` | Get live leaderboard from Redis |

### WebSocket
| Type | Endpoint | Description |
|------|----------|-------------|
| WS | `/ws/{room_key}` | Connect for live vote updates |

---

## Key Design Decisions

### Why Redis Sorted Sets for leaderboard?
```python
# Every vote increments the score atomically — O(log N)
await r.zincrby(f"poll:{poll_id}:votes", 1, str(option_id))

# Fetch top results instantly — no database query needed
await r.zrevrange(f"poll:{poll_id}:votes", 0, -1, withscores=True)
```

PostgreSQL stores every individual vote for audit trail and duplicate detection.
Redis stores only the counts for fast real-time display.
If Redis is lost, counts can be recomputed from PostgreSQL.

### Why Redis Pub/Sub for WebSocket?
```
Vote comes in → votes.py publishes to Redis channel
             → All WebSocket subscribers receive instantly
             → Each server broadcasts to its local connections
```

This supports horizontal scaling — multiple server instances
all subscribe to the same Redis channel, so every connected
client receives every update regardless of which server they're on.

### Duplicate vote prevention — two layers
```python
# Layer 1 — application check (fast, catches most cases)
existing = db.query(Vote).filter(
    Vote.poll_id == poll_id,
    Vote.voter_id == voter_id
).first()

# Layer 2 — database constraint (hard guarantee)
UniqueConstraint("poll_id", "voter_id", name="one_vote_per_person")
```

Two layers because application checks alone can fail under
race conditions at high concurrency. The database constraint
is the final hard guarantee.

### Why lazy Redis init?
```python
_redis = None

def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(os.getenv("REDIS_URL"))
    return _redis
```

Redis connection created on first request, not at import time.
Prevents startup timeout when deploying on free-tier servers
that boot slowly (like Render free tier).

---

## Data Flow — Casting a Vote
```
POST /votes/{room_key}
        │
        ▼
1. Find poll by room_key (PostgreSQL)
        │
        ▼
2. Check poll not expired (datetime comparison)
        │
        ▼
3. Check option belongs to this poll (PostgreSQL)
        │
        ▼
4. Check voter hasn't voted before (PostgreSQL query)
        │
        ▼
5. Save vote to database (PostgreSQL commit)
        │
        ▼
6. Increment option score (Redis ZINCRBY)
        │
        ▼
7. Publish update to Redis channel
        │
        ▼
8. WebSocket subscribers receive update
        │
        ▼
9. All connected browsers see new vote count
```

---

## Running Locally

**Prerequisites:** Python 3.10+, Redis
```bash
# 1. Start Redis
redis-server

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create .env file
echo "DATABASE_URL=sqlite:///./votelive.db" > .env
echo "REDIS_URL=redis://localhost:6379" >> .env
echo "SECRET_KEY=your-secret-key-here" >> .env

# 5. Start server
uvicorn main:app --reload
```

Open `http://localhost:8000/docs`

---

## Running Tests
```bash
pytest tests/ -v
```

Tests use:
- **SQLite** in-memory database — no PostgreSQL needed
- **Mocked Redis** — no Redis server needed
- **TestClient** — no running server needed

All 10 tests pass in under 2 seconds.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL or SQLite URL | `sqlite:///./votelive.db` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `SECRET_KEY` | JWT signing secret | `change-this-in-production` |

---

## What I'd add with more time

- **IP-based rate limiting** as second layer of duplicate vote prevention
- **Blind mode enforcement** — hide leaderboard from Redis until poll expires
- **Poll categories** — food, movies, tasks, party games
- **Webhook support** — notify external services when poll closes
- **Redis persistence** — AOF logging so vote counts survive Redis restart