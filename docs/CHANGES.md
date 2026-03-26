# VoteLive — All Changes Explained 


---

## Change 1: Timezone Bug Fix (Polls were expiring early)

### What was the problem?

Polls were showing "CLOSED" even though time was still left. For example, if you created a 5-minute poll, it would show expired immediately or much earlier than expected.

### Why was it happening?

The backend was using `datetime.utcnow()` which creates a **naive datetime** — meaning it has no timezone information attached to it. When Python sends this to the frontend as JSON, it looks like:

```
"2026-03-26T12:00:00"
```

Notice there's no `Z` at the end and no `+00:00`. When JavaScript sees `new Date("2026-03-26T12:00:00")` without any timezone indicator, it assumes it's in the **user's local timezone** (e.g. IST = UTC+5:30).

So if you're in India (IST, UTC+5:30) and the backend stored the expiry as 12:00 UTC, JavaScript thinks it's 12:00 IST, which is actually 6:30 UTC. The poll appears to expire 5.5 hours earlier than it should.

### What was changed?

**4 files changed:**

#### 1. `backend/auth.py`

- **Before:** `datetime.utcnow()` (naive — no timezone info)
- **After:** `datetime.now(timezone.utc)` (timezone-aware — includes UTC info)
- The `is_poll_expired()` function was also updated:
  - Now uses `datetime.now(timezone.utc)` instead of `datetime.utcnow()`
  - Added a safety check: if `expires_at` from the database is a naive datetime (old data), it attaches UTC timezone to it before comparing. This is **backward compatibility** — old polls in the database still work correctly.

#### 2. `backend/routers/polls.py`

- Same change: `datetime.utcnow()` → `datetime.now(timezone.utc)` in two places:
  - When calculating `expires_at` during poll creation
  - When filtering active polls in the list endpoint

#### 3. `backend/models.py`

- The `created_at` column default was `datetime.utcnow` (a function reference)
- Changed to `lambda: datetime.now(timezone.utc)` (a lambda that returns timezone-aware datetime)
- This affects both the `Poll` and `Vote` models

#### 4. `frontend/src/pages/Vote.jsx`

- Added a safeguard in the countdown timer:
  ```js
  const utcExpiry =
    expiresAt.endsWith('Z') || expiresAt.includes('+')
      ? expiresAt
      : expiresAt + 'Z';
  ```
- This checks: does the datetime string already have timezone info (`Z` or `+`)? If not, append `Z` (which means UTC in ISO 8601).
- This handles both old polls (naive datetime from DB) and new polls (timezone-aware).

### How to explain in one sentence:

> "The backend was storing dates without timezone info, so the frontend interpreted them as local time instead of UTC. We switched to timezone-aware datetimes and added a frontend fallback for backward compatibility."

---

## Change 2: Page Crash on Refresh (WebSocket + Timer Leak)

### What was the problem?

When anyone (creator or voter) refreshed the page while a poll was active, the page would crash (white screen / error).

### Why was it happening?

Three separate issues:

1. **Timer interval was never cleaned up.** The `checkExpiry` function created a `setInterval` that counted down every second, but the cleanup function (`clearInterval`) was returned from `checkExpiry` — not from the `useEffect`. So React never called it when the component unmounted. On refresh, the old interval would try to update state on an unmounted component → crash.

2. **WebSocket errors weren't handled.** If the WebSocket connection failed (e.g. backend was restarting, or network hiccup), there was no `onerror` handler and no `try/catch` around `JSON.parse`. A malformed message or connection error would throw an uncaught exception → crash.

3. **No cancellation flag.** API calls (fetching poll data, fetching results) could complete after the component unmounted. Setting state on an unmounted component causes a React warning/error.

### What was changed?

**File: `frontend/src/pages/Vote.jsx`** — This was the biggest rewrite.

#### Timer fix:

- **Before:** `checkExpiry` was called inside the main `useEffect` and returned a cleanup function, but that return value was ignored.
- **After:** Timer is in its **own separate `useEffect`** that depends on `poll?.expires_at`. The interval reference is stored in `timerRef` (a `useRef`). The `useEffect` cleanup function calls `clearInterval(timerRef.current)`. When the component unmounts or `expires_at` changes, React automatically cleans up the interval.

#### WebSocket fix:

- Added `try/catch` around `JSON.parse(e.data)` in the `onmessage` handler — bad messages don't crash the app
- Added `ws.onerror = () => {}` — swallows connection errors gracefully
- Added **auto-reconnect**: when the WebSocket closes, it waits 3 seconds and tries to reconnect (only if the component is still mounted)
- Uses a `cancelled` flag — set to `true` in the cleanup function. All callbacks check this flag before updating state.

#### Cancellation flag:

- `let cancelled = false` is set at the top of the `useEffect`
- In the cleanup: `cancelled = true`
- All `.then()` callbacks check `if (cancelled) return` before calling `setResults`, `setPoll`, etc.

### How to explain in one sentence:

> "The timer interval and WebSocket connection weren't being cleaned up when the component unmounted. We separated the timer into its own `useEffect` with proper `clearInterval`, added error handling and auto-reconnect to the WebSocket, and added a cancellation flag to prevent state updates on unmounted components."

---

## Change 3: End Poll Early Button

### What was the problem?

Once a poll was created, there was no way to end it before the timer ran out. The creator had to wait.

### What was added?

**Backend — new endpoint: `PATCH /polls/{room_key}/end`**

File: `backend/routers/polls.py`

- Takes a JSON body with `creator_id` (the voter_id of whoever is trying to end it)
- Looks up the poll by room_key
- **Security checks (in this order):**
  1. Poll must exist → 404 if not
  2. Poll must have a `creator_id` set → 403 if null (old polls without creator tracking can't be ended early)
  3. `creator_id` in the request must match `poll.creator_id` in the database → 403 if mismatch
- If all checks pass: sets `poll.expires_at` to `datetime.now(timezone.utc)` (i.e. "now"), which immediately makes it expired
- Returns `{"message": "Poll ended", "room_key": "..."}`

**Frontend — "End Poll Early" button**

File: `frontend/src/pages/Vote.jsx`

- A variable `isCreator` is computed: `poll?.creator_id && poll.creator_id === getVoterId()`
- The button only renders when `isCreator && !expired` — so only the creator sees it, and only while the poll is active
- Styled with a red border (`#ff4444`) to indicate it's a destructive action
- When clicked:
  - Sends `PATCH /polls/{room_key}/end` with the creator's `voter_id`
  - Sets `expired = true` and `timeLeft = "Closed"` immediately
  - Refreshes poll data from the server to get the updated `expires_at`
  - Has a `ending` loading state to prevent double-clicks

### Security note (bug that was caught and fixed):

The original code had this check:

```python
if poll.creator_id and poll.creator_id != body.creator_id:
```

This meant: if `creator_id` is `None` (null), the `if` is `False`, so the code skips the check and **anyone** can end the poll. This was fixed to:

```python
if not poll.creator_id:
    raise HTTPException(403, "This poll has no creator set — cannot be ended early")
if poll.creator_id != body.creator_id:
    raise HTTPException(403, "Only the creator can end this poll")
```

Now: no `creator_id` → can't end early. Wrong `creator_id` → rejected. Only exact match → allowed.

### How to explain in one sentence:

> "Added a `PATCH /polls/{room_key}/end` endpoint that only the poll creator can call, secured by matching the `creator_id` stored in the database. The frontend shows the button only to the creator."

---

## Change 4: Creator Tracking (`creator_id`)

### What was the problem?

There was no concept of "who created this poll." Every poll was anonymous — no one had special privileges.

### What was added?

#### Database model (`backend/models.py`)

- New column: `creator_id = Column(String, nullable=True)`
- It's `nullable=True` because old polls in the database don't have this field — they'll just have `NULL`

#### Schema (`backend/schemas.py`)

- `PollCreate` now has `creator_id: Optional[str] = None` — the frontend sends it when creating a poll
- `PollResponse` now includes `creator_id: Optional[str] = None` — the frontend reads it to check if the current user is the creator

#### Poll creation (`backend/routers/polls.py`)

- `create_poll` now passes `creator_id=poll_data.creator_id` to the `Poll` model

#### Frontend (`frontend/src/pages/CreatePoll.jsx`)

- The POST request now includes `creator_id: getVoterId()` — so the backend knows who created it

#### Auto-migration (`backend/main.py`)

- On startup, checks if the `creator_id` column exists in the `polls` table
- If not, runs `ALTER TABLE polls ADD COLUMN creator_id VARCHAR`
- This means **you don't need to delete the old database** — it upgrades automatically
- Wrapped in `try/except` so it doesn't crash if the table doesn't exist yet (fresh install)

### How to explain in one sentence:

> "Added a `creator_id` column to track who created each poll, with auto-migration for existing databases and the frontend sending the voter's ID when creating a poll."

---

## Change 5: Final Results Card (When Poll Closes)

### What was the problem?

When a poll expired, it just said "This poll is closed" — no summary of results.

### What was added?

File: `frontend/src/pages/Vote.jsx`

- When `expired && totalVotes > 0`, a **FINAL RESULTS** card appears below the options
- Shows results sorted by vote count (highest first)
- Winner gets a 🏆 emoji, bold text, and white color
- Each result shows: option text, vote count, and percentage
- Footer shows total vote count
- Styled consistently with the app's dark theme

### How to explain in one sentence:

> "Added a sorted results summary card that appears automatically when a poll closes, highlighting the winner."

---

## Change 6: Name Required Before Joining a Poll

### What was the problem?

Anyone could join a poll without identifying themselves — just enter a room key and you're in.

### What was added?

#### Shared voter utility (`frontend/src/utils/voter.js`) — NEW FILE

- `getVoterId()` — generates a random ID and stores it in localStorage (same logic that was previously duplicated in Vote.jsx)
- `getVoterName()` — reads name from localStorage
- `setVoterName(name)` — saves name to localStorage

#### Home page (`frontend/src/pages/Home.jsx`)

- Added a "Your name" text input above the room key input
- Name is pre-filled if already saved (from a previous visit)
- Validation: both name and room key are required before joining
- On join: name is saved to localStorage via `setVoterName()`

#### Vote page (`frontend/src/pages/Vote.jsx`)

- Removed the inline `getVoterId()` function — now imports from `utils/voter.js`

#### CreatePoll page (`frontend/src/pages/CreatePoll.jsx`)

- Now imports `getVoterId` from `utils/voter.js` instead of defining it locally

### How to explain in one sentence:

> "Users must enter their name before joining a poll. The name is persisted in localStorage and shared across sessions via a centralized voter utility module."

---

## Change 7: Resilient Results Endpoint (Redis Fallback to Database)

### What was the problem?

The `/votes/{room_key}/results` endpoint only read from Redis. If Redis was down (which happens — Render free tier, cold starts, etc.), the endpoint would crash with a 500 error, and no one could see any results.

### What was changed?

File: `backend/routers/votes.py`

- **Before:** Directly called `r.zrevrange(...)` — if Redis threw an exception, the entire request failed
- **After:** Wrapped Redis call in `try/except`:
  - **Happy path (Redis available):** Same as before — reads from Redis sorted set, fast
  - **Fallback (Redis down):** Runs a SQL query:
    ```python
    db.query(Vote.option_id, func.count(Vote.id))
      .filter(Vote.poll_id == poll.id)
      .group_by(Vote.option_id)
      .all()
    ```
    This counts votes directly from the `votes` table in SQLite/PostgreSQL
  - Logs a warning: `"Redis unavailable, falling back to database counts"`

### How to explain in one sentence:

> "The results endpoint now has a graceful fallback — if Redis is down, it counts votes from the database instead of crashing."

---

## Summary of All Files Changed

| File                                | What Changed                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `backend/auth.py`                   | Timezone-aware dates + backward-compatible `is_poll_expired()`               |
| `backend/models.py`                 | Timezone-aware `created_at` defaults + `creator_id` column                   |
| `backend/schemas.py`                | Added `creator_id` to `PollCreate` and `PollResponse`                        |
| `backend/main.py`                   | Auto-migration for `creator_id` column                                       |
| `backend/routers/polls.py`          | Timezone fix + `PATCH /{room_key}/end` endpoint                              |
| `backend/routers/votes.py`          | Redis fallback to database for results                                       |
| `frontend/src/utils/voter.js`       | **NEW** — shared voter ID and name utilities                                 |
| `frontend/src/pages/Vote.jsx`       | Timer cleanup, WebSocket auto-reconnect, End Poll button, Final Results card |
| `frontend/src/pages/Home.jsx`       | Name input field before joining                                              |
| `frontend/src/pages/CreatePoll.jsx` | Sends `creator_id` when creating poll                                        |

---

## How the Real-Time Flow Works (End to End)

This is useful for interviews — it shows you understand the full stack:

```
1. User clicks an option to vote
2. Frontend → POST /votes/{room_key} → Backend
3. Backend saves vote to SQLite database (permanent storage)
4. Backend runs ZINCRBY on Redis sorted set (fast counter)
5. Backend runs PUBLISH on Redis pub/sub channel
6. WebSocket handler (websocket.py) is subscribed to that channel
7. WebSocket handler broadcasts the update to ALL connected clients
8. Frontend ws.onmessage fires → setResults() updates the UI
9. React re-renders → vote counts update instantly, no refresh needed
```

**Key insight:** The database is the source of truth. Redis is the speed layer. If Redis goes down, votes still save and the results endpoint falls back to counting from the database.

---

## How the Security Works

| Attack                                     | Protection                                                           |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Someone tries to end another person's poll | Backend checks `creator_id` match — returns 403                      |
| Someone tries to vote twice                | Database has `UniqueConstraint("poll_id", "voter_id")` — returns 400 |
| Someone tries to vote on expired poll      | `is_poll_expired()` check — returns 400                              |
| Someone tries to vote with invalid option  | `Option.poll_id == poll.id` check — returns 404                      |
| Old polls without `creator_id`             | Can't be ended early (explicit 403), but still work for voting       |
| Naive datetimes in old DB rows             | `is_poll_expired()` adds UTC timezone before comparing               |
