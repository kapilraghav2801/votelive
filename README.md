# VoteLive

Real-time anonymous voting platform — no signup, no friction.

**Live:** [kapilraghav.info/votelive](https://kapilraghav.info/votelive)  
**Backend API:** [votelive.onrender.com](https://votelive.onrender.com/docs)  
**GitHub:** [kapilraghav2801/votelive](https://github.com/kapilraghav2801/votelive)

---

## What this does

Small groups waste 15+ minutes on simple decisions every day. VoteLive fixes that.

Someone creates a poll, shares a 6-character room key, and everyone votes anonymously in real time. Results update instantly via WebSocket — no refresh needed. Blind mode hides results until the poll closes, eliminating the bandwagon effect.

---

## Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | FastAPI | Async support, automatic API docs |
| Database | PostgreSQL (Neon) | ACID guarantees, audit trail |
| Cache + Leaderboard | Redis (Upstash) | O(log N) sorted sets, Pub/Sub |
| Frontend | React + Vite | Fast HMR, small bundle |
| Deployment | Render + Vercel | Free tier, zero-config CI |

---

## Architecture
```
User votes
    │
    ▼
FastAPI (Render)
    │
    ├── PostgreSQL (Neon)     ← stores every vote, enforces uniqueness
    │
    ├── Redis Sorted Set      ← ZINCRBY increments option score atomically
    │
    ├── Redis Pub/Sub         ← publishes vote event to channel
    │
    └── WebSocket Manager     ← fans out to all connected browsers
```

---

## Key Design Decisions

### Why Redis Sorted Sets for leaderboard?

Every vote atomically increments the option score — no race conditions because Redis is single-threaded. Fetching the top results is O(log N) regardless of how many votes exist.
```python
await r.zincrby(f"poll:{poll_id}:votes", 1, str(option_id))
await r.zrevrange(f"poll:{poll_id}:votes", 0, -1, withscores=True)
```

PostgreSQL stores every individual vote for duplicate detection and audit trail. Redis stores only the counts for fast real-time display. If Redis is lost, counts can be recomputed from PostgreSQL.

### Why Redis Pub/Sub for WebSocket fan-out?
```
Vote comes in → votes.py publishes to Redis channel
             → All WebSocket subscribers receive instantly
             → Each server instance broadcasts to local connections
```

This supports horizontal scaling — multiple server instances subscribe to the same Redis channel, so every connected client receives every update regardless of which server they hit.

### Two-layer duplicate vote prevention
```python
# Layer 1 — application check (fast path)
existing = db.query(Vote).filter(
    Vote.poll_id == poll_id,
    Vote.voter_id == voter_id
).first()

# Layer 2 — database constraint (hard guarantee)
UniqueConstraint("poll_id", "voter_id")
```

Application checks alone can fail under race conditions at high concurrency. The database constraint is the final hard guarantee.

### Lazy Redis init
```python
_redis = None

def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(os.getenv("REDIS_URL"))
    return _redis
```

Connection created on first request, not at import time. Prevents startup timeout on Render free tier which boots slowly after inactivity.

---

## Data Flow — Casting a Vote
```
POST /votes/{room_key}
    │
    ├── 1. Find poll by room_key (PostgreSQL)
    ├── 2. Check poll not expired (datetime comparison)
    ├── 3. Check option belongs to poll (PostgreSQL)
    ├── 4. Check voter hasn't voted (PostgreSQL query)
    ├── 5. Save vote to database (PostgreSQL commit)
    ├── 6. Increment score (Redis ZINCRBY)
    ├── 7. Publish to Redis channel
    └── 8. WebSocket fans out to all browsers
```

---

## Project Structure
```
votelive/
├── backend/
│   ├── main.py              # FastAPI app, CORS, DB init
│   ├── database.py          # SQLAlchemy engine, session factory
│   ├── models.py            # Poll, Option, Vote ORM models
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── auth.py              # JWT tokens, room key generation
│   ├── requirements.txt
│   └── routers/
│       ├── polls.py         # Create, get, list polls
│       ├── votes.py         # Cast vote, Redis leaderboard
│       └── websocket.py     # WebSocket, Pub/Sub fan-out
│   └── tests/
│       ├── conftest.py      # SQLite + mocked Redis fixtures
│       ├── test_polls.py    # 5 poll tests
│       └── test_votes.py    # 5 vote tests
└── frontend/
    └── src/
        ├── constants/api.js
        ├── components/
        │   ├── Navbar.jsx
        │   └── WakeUp.jsx   # Render cold-start handler
        └── pages/
            ├── Home.jsx     # Join or create poll
            ├── CreatePoll.jsx
            └── Vote.jsx     # Live voting + WebSocket results
```

---

## Running Locally

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# create .env
echo "DATABASE_URL=sqlite:///./votelive.db" > .env
echo "REDIS_URL=redis://localhost:6379" >> .env
echo "SECRET_KEY=your-secret-key" >> .env

uvicorn main:app --reload
# API docs at http://localhost:8000/docs
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# App at http://localhost:5173
```

---

## Tests
```bash
cd backend
pytest tests/ -v
```

10 tests, all passing. Uses SQLite in-memory + mocked Redis — no external services needed.

| Test | What it covers |
|---|---|
| `test_create_poll` | Poll creation with options |
| `test_get_poll_by_room_key` | Room key lookup |
| `test_get_poll_not_found` | 404 handling |
| `test_list_polls_returns_only_active` | Expired poll filtering |
| `test_create_poll_invalid_duration` | Input validation |
| `test_cast_vote_success` | Vote casting + Redis |
| `test_duplicate_vote_rejected` | Two-layer duplicate prevention |
| `test_vote_wrong_option` | Option validation |
| `test_vote_nonexistent_poll` | 404 on bad room key |
| `test_multiple_voters_same_poll` | Concurrent voter isolation |

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL or SQLite URL |
| `REDIS_URL` | Redis connection URL (`rediss://` for TLS) |
| `SECRET_KEY` | JWT signing secret |

---

## What I'd add with more time

- IP-based rate limiting as a third layer of duplicate prevention
- Blind mode enforcement at Redis level until poll expires
- Poll categories — food, movies, tasks, decisions
- Webhook support — notify external services when poll closes
- Redis AOF persistence so vote counts survive Redis restart