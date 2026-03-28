# Guessing Game — Backend Plan 

> This document walks you through **every backend file**, explaining:
> 1. **WHY** we need this file (what problem does it solve?)
> 2. **WHAT** we're thinking before writing a single line
> 3. **THE CODE** itself with line-by-line explanation
> 4. **WHAT IF IT WASN'T THERE** — what breaks without it?

---

## Quick Recap: How This Plugs Into VoteLive

Your existing VoteLive already has:
- `auth.py` → `generate_room_key()` — we reuse this for game rooms
- `database.py` → Redis lazy init pattern — we copy this for game state
- `routers/websocket.py` → WebSocket + Redis Pub/Sub — same pattern for game events
- `main.py` → router registration — we add one line to include guess game

**We are NOT touching any existing file except `main.py`** (to register the new router).
Everything else lives inside `backend/guess_game/`.

---

## File Order (Build in This Sequence)

```
1. models.py      ← Define data shapes FIRST (what does a game look like?)
2. game_logic.py   ← Pure logic SECOND (how does comparing/winning work?)
3. routes.py       ← REST endpoints THIRD (create room, validate room)
4. ws_handler.py   ← WebSocket LAST (real-time game communication)
5. __init__.py     ← Empty file (makes Python treat folder as a package)
```

Why this order? Because each file depends on the one before it.
`ws_handler.py` needs `game_logic.py` which needs `models.py`.

---

## File 1: `guess_game/models.py`

### What am I thinking before writing this?

**"What does a guessing game look like as data?"**

In our VoteLive, we have SQLAlchemy models (Poll, Option, Vote) stored in PostgreSQL.
But a guessing game is **temporary** — it lasts 2-5 minutes max. Storing it in PostgreSQL
would be wasteful. We'll store the entire game state in **Redis as a JSON string** with
a TTL (auto-delete after 30 minutes).

So `models.py` here is NOT SQLAlchemy models. It's **Pydantic models** — they define
the shape of the data we store in Redis. Think of them as blueprints.

I need to capture:
- Who are the two players? (names + IDs)
- What range did they pick? (1-100, 1-500, etc.)
- What secret numbers did they choose?
- Whose turn is it right now?
- What guesses have been made so far?
- What's the game status? (waiting, picking numbers, playing, finished)
- When did the current turn start? (for timer validation)

### The Code

```python
# backend/guess_game/models.py

from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class GameStatus(str, Enum):
    """
    Every possible state a game can be in.
    
    Why an Enum and not just strings?
    Because if you use plain strings like "waiting", you WILL typo it
    somewhere as "wating" and spend 2 hours debugging. Enums catch
    that at import time.
    
    The flow is:
    WAITING_FOR_PLAYER2 → PICKING_RANGE → PICKING_NUMBERS → PLAYING → FINISHED
    """
    WAITING_FOR_PLAYER2 = "waiting_for_player2"    # room created, user2 hasn't joined
    PICKING_RANGE = "picking_range"                 # user2 joined, user1 picks range
    PICKING_NUMBERS = "picking_numbers"             # range set, both pick secret numbers
    PLAYING = "playing"                             # both numbers locked, guessing started
    FINISHED = "finished"                           # someone won or game abandoned


class Player(BaseModel):
    """
    Represents one player in the game.
    
    Why a separate model for Player?
    Because both user1 and user2 have the same fields.
    Without this, you'd have:
      user1_id, user1_name, user1_secret, user2_id, user2_name, user2_secret
    That's messy. With Player model:
      player1: Player, player2: Player
    Clean.
    """
    player_id: str          # reuse voter_id from localStorage (same as VoteLive)
    name: str               # display name entered on join
    secret_number: Optional[int] = None   # their chosen number (None until they pick)
    has_submitted_secret: bool = False     # True after they lock in their number


class Guess(BaseModel):
    """
    One single guess attempt.
    
    Why store this?
    1. To show guess history on the UI (user1 guessed 50 → "Higher")
    2. To prevent the same number being guessed twice (optional rule)
    3. For the "replay" or "game summary" at the end
    """
    player_id: str          # who made this guess
    number: int             # what they guessed
    result: str             # "correct", "higher", or "lower"
    # "higher" means the secret number is HIGHER than the guess
    # "lower" means the secret number is LOWER than the guess


class GameState(BaseModel):
    """
    The ENTIRE state of one game. This is what gets stored in Redis.
    
    Why one big model?
    Because Redis stores key-value pairs. Our key is "guess_game:{room_key}"
    and our value is this entire object serialized to JSON.
    
    Every time something happens (a guess, a turn change), we:
    1. Read this from Redis
    2. Modify it in Python
    3. Write it back to Redis
    
    This is called the "read-modify-write" pattern.
    """
    room_key: str
    status: GameStatus = GameStatus.WAITING_FOR_PLAYER2
    
    # Players
    player1: Optional[Player] = None      # the room creator
    player2: Optional[Player] = None      # the one who joins
    
    # Game settings
    range_min: int = 1                    # default range start
    range_max: int = 100                  # default range end
    guess_time_seconds: int = 10          # seconds per guess (default 10)
    
    # Turn management
    current_turn: Optional[str] = None    # player_id of whose turn it is
    turn_started_at: Optional[float] = None  # Unix timestamp when turn began
    # Why Unix timestamp and not datetime?
    # Because JSON doesn't natively serialize datetime objects.
    # Unix timestamp is just a float like 1711540800.0 — easy to serialize.
    
    # Game history
    guesses: List[Guess] = []             # all guesses so far, in order
    
    # Result
    winner: Optional[str] = None          # player_id of winner (None until game ends)


# --- Request/Response schemas for REST endpoints ---

class CreateRoomRequest(BaseModel):
    """What the frontend sends when user1 clicks 'Create Room'"""
    player_name: str       # "Raghav"
    player_id: str         # from localStorage, same as voter_id


class CreateRoomResponse(BaseModel):
    """What the backend returns after creating the room"""
    room_key: str          # "abc123"
    message: str           # "Room created. Share this key."


class JoinRoomRequest(BaseModel):
    """What the frontend sends when user2 enters the room key"""
    player_name: str
    player_id: str


class SelectRangeRequest(BaseModel):
    """User1 picks the number range"""
    range_min: int         # 1
    range_max: int         # 100, 500, or 1000
    player_id: str


class SubmitSecretRequest(BaseModel):
    """A player submits their secret number"""
    secret_number: int
    player_id: str


class SubmitGuessRequest(BaseModel):
    """A player submits a guess"""
    guess_number: int
    player_id: str
```

### What if this file didn't exist?

Without Pydantic models, you'd be passing raw dictionaries everywhere:
```python
# WITHOUT models (bad):
game = {"room_key": "abc", "player1": {"name": "Raghav", "secret": 42}}
# Typo "secrt" instead of "secret"? No error. Silent bug. Good luck debugging.

# WITH models (good):
game = GameState(room_key="abc", player1=Player(name="Raghav", secrt=42))
# ❌ Pydantic immediately throws: "unexpected keyword argument 'secrt'"
```

Pydantic validates data at creation time. It's your safety net.

---

## File 2: `guess_game/game_logic.py`

### What am I thinking before writing this?

I need a file with **pure functions** — functions that take input, return output,
and don't touch Redis or WebSocket or any external system.

Why separate this from ws_handler.py?

1. **Testability.** You can write unit tests for `compare_guess(50, 65)` without
   mocking Redis or WebSocket. Just call the function and check the result.
2. **Readability.** When someone reads ws_handler.py, they see `result = compare_guess(...)`.
   They don't need to understand the comparison logic inline — it's abstracted away.
3. **Reusability.** If you later add an AI opponent, the same `compare_guess` works.

The functions I need:
- Compare a guess against a secret number → "correct", "higher", "lower"
- Check if a guess is within the valid range
- Determine whose turn it is next
- Check if the timer has expired
- Validate that a player is allowed to act right now

### The Code

```python
# backend/guess_game/game_logic.py

import time
from guess_game.models import GameState, GameStatus, Guess


def compare_guess(guess: int, secret: int) -> str:
    """
    Compares a guess against the secret number.
    
    Returns:
      "correct" — guess matches secret exactly
      "higher"  — the secret is HIGHER than the guess (guess too low)
      "lower"   — the secret is LOWER than the guess (guess too high)
    
    Example:
      Secret = 65, Guess = 50  → "higher" (65 is higher than 50)
      Secret = 65, Guess = 80  → "lower"  (65 is lower than 80)
      Secret = 65, Guess = 65  → "correct"
    
    Why is this its own function?
    Because this is the CORE game mechanic. If you inline this in the
    WebSocket handler, it gets buried in 200 lines of connection management.
    Here, it's 6 lines and dead simple to test.
    """
    if guess == secret:
        return "correct"
    elif guess < secret:
        return "higher"   # secret is higher
    else:
        return "lower"    # secret is lower


def is_valid_guess(guess: int, game: GameState) -> bool:
    """
    Checks if a guess number is within the game's range.
    
    Why validate this on the backend?
    Because the frontend can be manipulated. Someone could open browser
    DevTools, modify the JavaScript, and send guess=99999 on a 1-100 range.
    Backend validation is the real guard.
    """
    return game.range_min <= guess <= game.range_max


def is_valid_secret(secret: int, game: GameState) -> bool:
    """
    Checks if a secret number is within the game's range.
    Same reasoning as is_valid_guess — never trust frontend data.
    """
    return game.range_min <= secret <= game.range_max


def is_players_turn(player_id: str, game: GameState) -> bool:
    """
    Checks if it's this player's turn to guess.
    
    Why do we need this?
    Without this check, player1 could send 10 guesses in a row while
    it's player2's turn. The WebSocket doesn't care who sends messages —
    it's the backend's job to enforce turn order.
    """
    return game.current_turn == player_id


def is_turn_expired(game: GameState) -> bool:
    """
    Checks if the current turn's timer has run out.
    
    Why check on backend instead of just trusting the frontend timer?
    Because a player could hack their frontend to never send "timer_expired".
    The backend independently tracks when the turn started and can
    force-skip if too much time has passed.
    
    We add a 2-second buffer (grace period) because:
    1. Network latency — the guess might arrive 0.5s after the timer shows 0
    2. WebSocket delivery isn't instant
    Without the buffer, legitimate guesses made at the last second get rejected.
    """
    if game.turn_started_at is None:
        return False
    elapsed = time.time() - game.turn_started_at
    return elapsed > (game.guess_time_seconds + 2)  # 2s grace period


def get_opponent_id(player_id: str, game: GameState) -> str:
    """
    Given one player's ID, returns the other player's ID.
    
    This is used to:
    1. Figure out whose secret to compare against
    2. Switch turns after a guess
    3. Send notifications to the right player
    """
    if game.player1 and game.player1.player_id == player_id:
        return game.player2.player_id
    return game.player1.player_id


def get_opponent_secret(player_id: str, game: GameState) -> int:
    """
    Gets the secret number of the OPPONENT.
    
    When player1 guesses, we compare against player2's secret.
    When player2 guesses, we compare against player1's secret.
    
    This is the number the guesser is trying to find.
    """
    if game.player1 and game.player1.player_id == player_id:
        return game.player2.secret_number
    return game.player1.secret_number


def switch_turn(game: GameState) -> GameState:
    """
    Switches the turn to the other player and resets the timer.
    
    Returns a NEW game state (we don't modify in place).
    
    Why reset turn_started_at here?
    Because the timer starts fresh for each turn. If player1 used 7 seconds,
    player2 still gets the full 10 seconds. Each turn is independent.
    """
    opponent_id = get_opponent_id(game.current_turn, game)
    game.current_turn = opponent_id
    game.turn_started_at = time.time()
    return game


def process_guess(player_id: str, guess_number: int, game: GameState) -> dict:
    """
    The main game function. Processes a guess and returns what happened.
    
    This is called by ws_handler.py whenever a player submits a guess.
    
    Returns a dict with:
    {
      "result": "correct" | "higher" | "lower",
      "guess": Guess object,
      "game_over": True | False,
      "winner": player_id | None
    }
    
    Why return a dict instead of modifying game directly?
    Because ws_handler.py needs to know what happened to broadcast
    the right WebSocket message. The dict tells it everything.
    """
    opponent_secret = get_opponent_secret(player_id, game)
    result = compare_guess(guess_number, opponent_secret)
    
    # Create the guess record
    guess = Guess(
        player_id=player_id,
        number=guess_number,
        result=result
    )
    
    # Add to history
    game.guesses.append(guess)
    
    if result == "correct":
        # Game over! This player wins
        game.status = GameStatus.FINISHED
        game.winner = player_id
        return {
            "result": "correct",
            "guess": guess,
            "game_over": True,
            "winner": player_id
        }
    else:
        # Not correct — switch turn
        game = switch_turn(game)
        return {
            "result": result,
            "guess": guess,
            "game_over": False,
            "winner": None
        }
```

### What if this file didn't exist?

All this logic would be inside `ws_handler.py`, making it 400+ lines of tangled
WebSocket code mixed with game rules. When a bug happens (and it will), you
wouldn't know if the problem is in the WebSocket connection, the Redis read/write,
or the actual game logic. Separating them means you can test `compare_guess(50, 65)`
in a unit test without any server running.

---

## File 3: `guess_game/routes.py`

### What am I thinking before writing this?

I need **two REST endpoints**. Not everything should be a WebSocket message.

**Why REST for room creation and not WebSocket?**

Think about it: when user1 clicks "Create Room", they're not connected via
WebSocket yet. They need to create the room FIRST, get the room key, THEN
connect via WebSocket. Same for user2 — they need to validate the room key
exists BEFORE opening a WebSocket connection.

REST endpoints are also easier to test (just curl or Postman) and don't
require maintaining a persistent connection.

The two endpoints:
1. `POST /guess-game/create` — creates a room, returns room key
2. `GET /guess-game/{room_key}/validate` — checks if a room exists and is joinable

### The Code

```python
# backend/guess_game/routes.py

from fastapi import APIRouter, HTTPException
from guess_game.models import (
    GameState, GameStatus, Player,
    CreateRoomRequest, CreateRoomResponse
)
from auth import generate_room_key  # REUSING your existing function!
import redis.asyncio as aioredis
import os
import json

router = APIRouter(prefix="/guess-game", tags=["guess-game"])

# --- Redis connection (same lazy init pattern as your votes.py) ---

_redis = None

def get_redis():
    """
    Same pattern as your votes.py — lazy init.
    
    Why not import from votes.py?
    Because coupling two modules to the same Redis instance variable
    means resetting one in tests resets the other. Keep them independent.
    The actual Redis SERVER is the same — it's the Python connection
    object that's separate.
    """
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True
        )
    return _redis


def reset_redis():
    """For tests — same pattern as votes.py"""
    global _redis
    _redis = None


# --- Helper: Save/Load game state from Redis ---

async def save_game(game: GameState):
    """
    Saves the entire game state to Redis as a JSON string.
    
    Key format: "guess_game:{room_key}"
    TTL: 1800 seconds = 30 minutes
    
    Why 30 minutes TTL?
    A game should last 2-5 minutes. 30 minutes gives plenty of buffer
    for slow players, reconnections, etc. After 30 min of no activity,
    Redis auto-deletes the key. No cleanup code needed. This is why
    Redis is perfect for temporary game state.
    
    Why not PostgreSQL?
    - Games are temporary — PostgreSQL is for permanent data
    - You'd need a cron job to clean up old games
    - Redis TTL handles cleanup automatically
    - Redis is faster for frequent read/write (every guess = 1 read + 1 write)
    """
    r = get_redis()
    await r.set(
        f"guess_game:{game.room_key}",
        game.model_dump_json(),   # Pydantic v2 method to serialize to JSON string
        ex=1800                   # expire in 30 minutes
    )


async def load_game(room_key: str) -> GameState:
    """
    Loads game state from Redis and deserializes it.
    
    Why can this return None?
    1. Room key doesn't exist (typo, never created)
    2. Game expired (30 min TTL passed)
    3. Redis was restarted (data lost — Redis is in-memory)
    
    The caller must handle None appropriately (return 404, etc.)
    """
    r = get_redis()
    data = await r.get(f"guess_game:{room_key}")
    if data is None:
        return None
    return GameState.model_validate_json(data)  # JSON string → Pydantic model


# --- REST Endpoints ---

@router.post("/create", response_model=CreateRoomResponse)
async def create_room(req: CreateRoomRequest):
    """
    Creates a new game room.
    
    Flow:
    1. Generate a unique 6-char room key (reusing your auth.py function)
    2. Create initial game state with player1 filled in
    3. Save to Redis
    4. Return room key to frontend
    
    Why check for collision?
    Same reason as your polls.py — two rooms could get the same random key.
    With 26^6 = 308M possibilities it's rare, but we check anyway.
    Unlike polls.py where we check PostgreSQL, here we check Redis.
    """
    r = get_redis()
    
    # Generate unique room key
    while True:
        room_key = generate_room_key()
        existing = await r.get(f"guess_game:{room_key}")
        if existing is None:
            break
    
    # Create initial game state
    game = GameState(
        room_key=room_key,
        status=GameStatus.WAITING_FOR_PLAYER2,
        player1=Player(
            player_id=req.player_id,
            name=req.player_name
        )
    )
    
    await save_game(game)
    
    return CreateRoomResponse(
        room_key=room_key,
        message="Room created. Share this key with your opponent."
    )


@router.get("/{room_key}/validate")
async def validate_room(room_key: str):
    """
    Checks if a room exists and returns its current status.
    
    Why a separate validation endpoint?
    
    Without this, user2 would enter a room key → frontend opens WebSocket →
    WebSocket immediately closes with error → bad UX.
    
    With this, user2 enters room key → frontend calls this endpoint →
    if 404, shows "Room not found" inline → no broken WebSocket needed.
    
    Also returns game status so frontend knows what screen to show:
    - "waiting_for_player2" → show "Join" button
    - "playing" → show "Game in progress" (can't join mid-game)
    - "finished" → show "Game over"
    """
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return {
        "room_key": room_key,
        "status": game.status,
        "player1_name": game.player1.name if game.player1 else None,
        "player2_name": game.player2.name if game.player2 else None,
        "range_min": game.range_min,
        "range_max": game.range_max,
        "can_join": game.status == GameStatus.WAITING_FOR_PLAYER2
    }
```

### What if this file didn't exist?

You'd have to create rooms through WebSocket, which means user1 would need to
open a WebSocket connection to... nothing? There's no room yet. It's a chicken-and-egg
problem. REST creates the room, WebSocket connects to it. They serve different purposes.

---

## File 4: `guess_game/ws_handler.py`

### What am I thinking before writing this?

This is the **big one**. The real-time engine. Every game action after room creation
happens through WebSocket messages.

Looking at your existing `routers/websocket.py`, I see your pattern:
- One WebSocket endpoint per room key
- Redis Pub/Sub for fan-out
- `active_connections` dict tracking who's connected

For the guessing game, the flow is different:
- VoteLive: many clients → one channel (broadcast vote counts)
- Guess Game: exactly 2 clients → private messages to each other

So I need to decide: **do I use Redis Pub/Sub or direct WebSocket messages?**

**Decision: Direct WebSocket messages (no Pub/Sub needed).**

Why? Because there are only 2 players. Pub/Sub is for when you have multiple
server instances and need to broadcast across them. For 2 players on a single
Render free-tier server, we can just keep both WebSocket connections in memory
and send messages directly. Simpler = better for now.

If you ever scale to multiple server instances, you'd add Pub/Sub back.
But that's a problem for 10,000 concurrent games, not for a portfolio project.

**The WebSocket message types (events) I need to handle:**

| Frontend sends | Backend does | Backend responds |
|---|---|---|
| `join_room` | Adds player2 to game | Notifies both players |
| `select_range` | Sets range_min/max | Notifies player2 to pick number |
| `submit_secret` | Stores player's secret | When both submitted, starts game |
| `submit_guess` | Compares guess vs secret | Sends result + switches turn |
| `timer_expired` | Skips current turn | Switches to other player |

### The Code

```python
# backend/guess_game/ws_handler.py

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from guess_game.models import (
    GameState, GameStatus, Player, Guess
)
from guess_game.routes import load_game, save_game
from guess_game.game_logic import (
    compare_guess, is_valid_guess, is_valid_secret,
    is_players_turn, is_turn_expired, get_opponent_id,
    process_guess, switch_turn
)
import json
import time

router = APIRouter()

# Track active WebSocket connections per game room
# Structure: { "room_key": { "player_id": WebSocket } }
#
# Why a dict of dicts (not a list)?
# Because we need to send DIFFERENT messages to each player.
# Player1 sees "Your turn" while player2 sees "Opponent is guessing".
# With a list, you can't target a specific player easily.
game_connections: dict = {}


async def send_to_player(room_key: str, player_id: str, message: dict):
    """
    Sends a WebSocket message to ONE specific player.
    
    Why wrap this in a function?
    1. The try/except handles disconnected players gracefully
    2. Without try/except, a disconnected player crashes the entire game
    3. We reuse this 20+ times in this file — DRY principle
    """
    connections = game_connections.get(room_key, {})
    ws = connections.get(player_id)
    if ws:
        try:
            await ws.send_text(json.dumps(message))
        except:
            # Player disconnected — remove their connection
            connections.pop(player_id, None)


async def send_to_both(room_key: str, message: dict):
    """
    Sends the SAME message to both players.
    Used for events like "game started", "game over".
    """
    connections = game_connections.get(room_key, {})
    disconnected = []
    for pid, ws in connections.items():
        try:
            await ws.send_text(json.dumps(message))
        except:
            disconnected.append(pid)
    for pid in disconnected:
        connections.pop(pid, None)


async def send_game_state(room_key: str, game: GameState):
    """
    Sends a SANITIZED game state to both players.
    
    CRITICAL: We must NOT send the opponent's secret number!
    If we send the full game state, the player can open DevTools →
    Network tab → see the WebSocket message → read the opponent's
    secret number → cheat.
    
    So we create a custom message for EACH player that hides
    the opponent's secret.
    """
    if game.player1:
        await send_to_player(room_key, game.player1.player_id, {
            "type": "game_state",
            "status": game.status,
            "room_key": game.room_key,
            "player1": {
                "name": game.player1.name,
                "player_id": game.player1.player_id,
                "has_submitted_secret": game.player1.has_submitted_secret
                # Notice: NO secret_number here!
            },
            "player2": {
                "name": game.player2.name if game.player2 else None,
                "player_id": game.player2.player_id if game.player2 else None,
                "has_submitted_secret": game.player2.has_submitted_secret if game.player2 else False
            } if game.player2 else None,
            "range_min": game.range_min,
            "range_max": game.range_max,
            "current_turn": game.current_turn,
            "guess_time_seconds": game.guess_time_seconds,
            "guesses": [g.model_dump() for g in game.guesses],
            "winner": game.winner
        })
    
    if game.player2:
        await send_to_player(room_key, game.player2.player_id, {
            "type": "game_state",
            "status": game.status,
            "room_key": game.room_key,
            "player1": {
                "name": game.player1.name,
                "player_id": game.player1.player_id,
                "has_submitted_secret": game.player1.has_submitted_secret
            },
            "player2": {
                "name": game.player2.name,
                "player_id": game.player2.player_id,
                "has_submitted_secret": game.player2.has_submitted_secret
            },
            "range_min": game.range_min,
            "range_max": game.range_max,
            "current_turn": game.current_turn,
            "guess_time_seconds": game.guess_time_seconds,
            "guesses": [g.model_dump() for g in game.guesses],
            "winner": game.winner
        })


# ====================================================================
# EVENT HANDLERS — one function per WebSocket message type
# ====================================================================

async def handle_join_room(room_key: str, data: dict, ws: WebSocket):
    """
    Player2 joins an existing room.
    
    Validation checklist:
    1. Room must exist in Redis
    2. Room must be in WAITING_FOR_PLAYER2 status
    3. Player can't join their own room
    
    After joining:
    - Add player2 to game state
    - Change status to PICKING_RANGE
    - Notify player1 that player2 has joined
    - Send updated game state to both
    """
    game = await load_game(room_key)
    if game is None:
        await ws.send_text(json.dumps({"type": "error", "message": "Room not found"}))
        return
    
    if game.status != GameStatus.WAITING_FOR_PLAYER2:
        await ws.send_text(json.dumps({"type": "error", "message": "Room is not accepting players"}))
        return
    
    player_id = data.get("player_id")
    player_name = data.get("player_name")
    
    if game.player1.player_id == player_id:
        await ws.send_text(json.dumps({"type": "error", "message": "You can't join your own room"}))
        return
    
    # Add player2
    game.player2 = Player(player_id=player_id, name=player_name)
    game.status = GameStatus.PICKING_RANGE
    
    # Register WebSocket connection
    if room_key not in game_connections:
        game_connections[room_key] = {}
    game_connections[room_key][player_id] = ws
    
    await save_game(game)
    
    # Notify player1
    await send_to_player(room_key, game.player1.player_id, {
        "type": "player_joined",
        "player_name": player_name
    })
    
    # Send full state to both
    await send_game_state(room_key, game)


async def handle_select_range(room_key: str, data: dict):
    """
    Player1 selects the number range (e.g., 1-100).
    
    Why only player1?
    Because player1 created the room — they're the "host".
    This is a design decision, not a technical limitation.
    You could let either player pick the range, but having the
    host decide keeps the UX simple.
    """
    game = await load_game(room_key)
    if game is None:
        return
    
    if game.status != GameStatus.PICKING_RANGE:
        await send_to_both(room_key, {"type": "error", "message": "Not in range picking phase"})
        return
    
    player_id = data.get("player_id")
    if player_id != game.player1.player_id:
        await send_to_player(room_key, player_id, {
            "type": "error", "message": "Only the host can select the range"
        })
        return
    
    # Set range
    game.range_min = data.get("range_min", 1)
    game.range_max = data.get("range_max", 100)
    game.status = GameStatus.PICKING_NUMBERS
    
    await save_game(game)
    
    # Tell both players to pick their secret numbers
    await send_to_both(room_key, {
        "type": "pick_your_number",
        "range_min": game.range_min,
        "range_max": game.range_max,
        "message": f"Choose your secret number between {game.range_min} and {game.range_max}"
    })
    
    await send_game_state(room_key, game)


async def handle_submit_secret(room_key: str, data: dict):
    """
    A player submits their secret number.
    
    Both players must submit before the game starts.
    When BOTH have submitted, the game automatically transitions to PLAYING.
    
    Flow:
    1. Player1 submits → stored, status stays PICKING_NUMBERS
    2. Player2 submits → stored, BOTH done → status changes to PLAYING
       (order doesn't matter — player2 could submit first)
    """
    game = await load_game(room_key)
    if game is None:
        return
    
    if game.status != GameStatus.PICKING_NUMBERS:
        return
    
    player_id = data.get("player_id")
    secret = data.get("secret_number")
    
    # Validate the secret number
    if not is_valid_secret(secret, game):
        await send_to_player(room_key, player_id, {
            "type": "error",
            "message": f"Number must be between {game.range_min} and {game.range_max}"
        })
        return
    
    # Store the secret for the correct player
    if game.player1 and game.player1.player_id == player_id:
        game.player1.secret_number = secret
        game.player1.has_submitted_secret = True
    elif game.player2 and game.player2.player_id == player_id:
        game.player2.secret_number = secret
        game.player2.has_submitted_secret = True
    else:
        return  # Unknown player — ignore
    
    await save_game(game)
    
    # Notify the player that their number is locked
    await send_to_player(room_key, player_id, {
        "type": "secret_locked",
        "message": "Your number is locked in!"
    })
    
    # Notify the OTHER player (without revealing the number)
    opponent_id = get_opponent_id(player_id, game)
    await send_to_player(room_key, opponent_id, {
        "type": "opponent_ready",
        "message": "Your opponent has chosen their number"
    })
    
    # Check if BOTH players have submitted
    if game.player1.has_submitted_secret and game.player2.has_submitted_secret:
        # START THE GAME!
        game.status = GameStatus.PLAYING
        game.current_turn = game.player1.player_id  # Player1 guesses first
        game.turn_started_at = time.time()
        
        await save_game(game)
        
        await send_to_both(room_key, {
            "type": "game_started",
            "message": "Both numbers locked! Game begins!",
            "current_turn": game.current_turn,
            "first_player_name": game.player1.name,
            "guess_time_seconds": game.guess_time_seconds
        })
        
        await send_game_state(room_key, game)


async def handle_submit_guess(room_key: str, data: dict):
    """
    The active player submits a guess.
    
    This is the CORE game loop handler. Everything leads here.
    
    Validation:
    1. Game must be in PLAYING status
    2. Must be this player's turn
    3. Timer must not have expired
    4. Guess must be within range
    
    Then:
    - Compare guess vs opponent's secret (via game_logic.py)
    - If correct → game over, broadcast winner
    - If wrong → send higher/lower hint, switch turn
    """
    game = await load_game(room_key)
    if game is None:
        return
    
    if game.status != GameStatus.PLAYING:
        return
    
    player_id = data.get("player_id")
    guess_number = data.get("guess_number")
    
    # Check if it's their turn
    if not is_players_turn(player_id, game):
        await send_to_player(room_key, player_id, {
            "type": "error", "message": "Not your turn!"
        })
        return
    
    # Check timer
    if is_turn_expired(game):
        # Auto-skip to other player
        game = switch_turn(game)
        await save_game(game)
        await send_to_both(room_key, {
            "type": "turn_skipped",
            "reason": "timer_expired",
            "skipped_player": player_id,
            "current_turn": game.current_turn,
            "guess_time_seconds": game.guess_time_seconds
        })
        await send_game_state(room_key, game)
        return
    
    # Validate guess range
    if not is_valid_guess(guess_number, game):
        await send_to_player(room_key, player_id, {
            "type": "error",
            "message": f"Guess must be between {game.range_min} and {game.range_max}"
        })
        return
    
    # PROCESS THE GUESS — this is where game_logic.py does its job
    result = process_guess(player_id, guess_number, game)
    
    await save_game(game)
    
    if result["game_over"]:
        # GAME OVER — someone won!
        winner_name = ""
        if game.player1 and game.player1.player_id == result["winner"]:
            winner_name = game.player1.name
        elif game.player2:
            winner_name = game.player2.name
        
        await send_to_both(room_key, {
            "type": "game_over",
            "winner": result["winner"],
            "winner_name": winner_name,
            "winning_guess": guess_number,
            "total_guesses": len(game.guesses),
            "player1_secret": game.player1.secret_number,
            "player2_secret": game.player2.secret_number,
            # Now that the game is over, we CAN reveal both secrets
        })
        
        await send_game_state(room_key, game)
        
        # Clean up connections (optional — Redis TTL will handle the data)
        game_connections.pop(room_key, None)
    else:
        # Not correct — send hint and switch turn
        # Get the guesser's name for the notification
        guesser_name = ""
        if game.player1 and game.player1.player_id == player_id:
            guesser_name = game.player1.name
        elif game.player2:
            guesser_name = game.player2.name
        
        await send_to_both(room_key, {
            "type": "guess_result",
            "player_id": player_id,
            "player_name": guesser_name,
            "guess_number": guess_number,
            "result": result["result"],  # "higher" or "lower"
            "current_turn": game.current_turn,  # already switched by process_guess
            "guess_time_seconds": game.guess_time_seconds
        })
        
        await send_game_state(room_key, game)


async def handle_timer_expired(room_key: str, data: dict):
    """
    Frontend reports that the timer ran out for the current player.
    
    Why does the frontend send this instead of the backend detecting it?
    
    The backend COULD run a background task that checks every second.
    But that's complex — you need asyncio tasks, cleanup logic, etc.
    The simpler approach: frontend sends this event, backend validates
    it (using turn_started_at) and skips the turn.
    
    Backend still validates independently — it doesn't blindly trust
    the frontend. If the frontend sends timer_expired after only 3 seconds,
    the backend will see turn_started_at was 3 seconds ago and reject it.
    """
    game = await load_game(room_key)
    if game is None:
        return
    
    if game.status != GameStatus.PLAYING:
        return
    
    # Verify the timer actually expired (backend check)
    if not is_turn_expired(game):
        return  # Frontend lied or network was slow — ignore
    
    skipped_player = game.current_turn
    game = switch_turn(game)
    
    await save_game(game)
    
    await send_to_both(room_key, {
        "type": "turn_skipped",
        "reason": "timer_expired",
        "skipped_player": skipped_player,
        "current_turn": game.current_turn,
        "guess_time_seconds": game.guess_time_seconds
    })
    
    await send_game_state(room_key, game)


# ====================================================================
# MAIN WEBSOCKET ENDPOINT
# ====================================================================

@router.websocket("/ws/guess-game/{room_key}")
async def guess_game_websocket(room_key: str, websocket: WebSocket):
    """
    The main WebSocket endpoint for the guessing game.
    
    How it works:
    1. Client connects with their player_id as a query param
    2. We accept the connection and register it
    3. We listen for JSON messages in a loop
    4. Each message has a "type" field that tells us what event it is
    5. We route to the appropriate handler function
    
    URL format: ws://localhost:8000/ws/guess-game/abc123?player_id=xyz
    
    Why pass player_id as query param?
    Because WebSocket doesn't have a "body" on the initial connection.
    You can't send JSON until AFTER the connection is established.
    Query params are the standard way to identify who's connecting.
    
    Why a different URL path than your existing /ws/{room_key}?
    To avoid conflicts with VoteLive's existing WebSocket endpoint.
    /ws/{room_key} is for polls, /ws/guess-game/{room_key} is for games.
    """
    # Get player_id from query params
    player_id = websocket.query_params.get("player_id")
    if not player_id:
        await websocket.close(code=4001)
        return
    
    # Verify room exists
    game = await load_game(room_key)
    if game is None:
        await websocket.close(code=4004)
        return
    
    # Accept connection
    await websocket.accept()
    
    # Register connection
    if room_key not in game_connections:
        game_connections[room_key] = {}
    game_connections[room_key][player_id] = websocket
    
    # Send current game state to the connecting player
    await send_game_state(room_key, game)
    
    try:
        # Main message loop — runs forever until client disconnects
        while True:
            # Wait for next message from this client
            raw = await websocket.receive_text()
            
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "type": "error", "message": "Invalid JSON"
                }))
                continue
            
            # Route to the correct handler based on message type
            msg_type = data.get("type")
            
            if msg_type == "join_room":
                await handle_join_room(room_key, data, websocket)
            
            elif msg_type == "select_range":
                await handle_select_range(room_key, data)
            
            elif msg_type == "submit_secret":
                await handle_submit_secret(room_key, data)
            
            elif msg_type == "submit_guess":
                await handle_submit_guess(room_key, data)
            
            elif msg_type == "timer_expired":
                await handle_timer_expired(room_key, data)
            
            else:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}"
                }))
    
    except WebSocketDisconnect:
        # Player disconnected — clean up their connection
        if room_key in game_connections:
            game_connections[room_key].pop(player_id, None)
            
            # Notify the other player
            remaining = game_connections.get(room_key, {})
            for pid, ws in remaining.items():
                try:
                    await ws.send_text(json.dumps({
                        "type": "opponent_disconnected",
                        "message": "Your opponent disconnected"
                    }))
                except:
                    pass
            
            # If no one is left, clean up
            if not remaining:
                game_connections.pop(room_key, None)
```

### What if this file didn't exist?

No real-time gameplay. Players would have to refresh the page to see if their
opponent has guessed. That's not a game — that's email with extra steps.

---

## File 5: `guess_game/__init__.py`

### The Code

```python
# backend/guess_game/__init__.py

# Empty file.
# 
# Why does this exist?
# Python needs __init__.py to recognize a folder as a "package" 
# that can be imported.
# Without it: "from guess_game.models import GameState" → ModuleNotFoundError
# With it: works perfectly.
```

---

## File 6: Changes to `main.py`

### What am I thinking?

We need to register the new routers so FastAPI knows about our endpoints.
Two lines added. That's it.

### The Code (add these 3 lines to your existing main.py)

```python
# Add these imports at the top with your other imports:
from guess_game.routes import router as guess_game_router
from guess_game.ws_handler import router as guess_game_ws_router

# Add these lines after your existing app.include_router() calls:
app.include_router(guess_game_router)
app.include_router(guess_game_ws_router)
```

### What if you forgot this?

Your guess game files would exist but FastAPI wouldn't know about them.
Requests to `/guess-game/create` would return 404. WebSocket connections
to `/ws/guess-game/{room_key}` would fail. The code exists but is invisible.

---

## How Everything Connects (End-to-End Flow)

```
USER1 clicks "Create Room"
│
├─→ Frontend: POST /guess-game/create { player_name: "Raghav", player_id: "abc" }
│      │
│      └─→ routes.py: create_room()
│            ├── generate_room_key() → "x7k2m9"
│            ├── Create GameState (status: WAITING_FOR_PLAYER2)
│            ├── Save to Redis: "guess_game:x7k2m9" → JSON
│            └── Return: { room_key: "x7k2m9" }
│
├─→ Frontend: Open WebSocket ws://server/ws/guess-game/x7k2m9?player_id=abc
│      │
│      └─→ ws_handler.py: guess_game_websocket()
│            ├── Accept connection
│            ├── Register in game_connections["x7k2m9"]["abc"] = ws
│            └── Send current game state to user1
│
USER2 enters room key "x7k2m9"
│
├─→ Frontend: GET /guess-game/x7k2m9/validate
│      └─→ routes.py: validate_room() → { can_join: true }
│
├─→ Frontend: Open WebSocket ws://server/ws/guess-game/x7k2m9?player_id=xyz
│
├─→ Frontend sends: { type: "join_room", player_name: "Alex", player_id: "xyz" }
│      │
│      └─→ ws_handler.py: handle_join_room()
│            ├── Load game from Redis
│            ├── Add player2 to game
│            ├── Status → PICKING_RANGE
│            ├── Save to Redis
│            ├── Notify player1: "Alex joined!"
│            └── Send game state to both
│
USER1 picks range 1-100
│
├─→ Frontend sends: { type: "select_range", range_min: 1, range_max: 100 }
│      │
│      └─→ ws_handler.py: handle_select_range()
│            ├── Status → PICKING_NUMBERS
│            └── Tell both: "Pick your secret number"
│
BOTH USERS pick secret numbers (say 94 and 65)
│
├─→ Each sends: { type: "submit_secret", secret_number: XX }
│      │
│      └─→ ws_handler.py: handle_submit_secret()
│            ├── Store secret, mark as submitted
│            ├── When BOTH done: Status → PLAYING
│            ├── current_turn = player1
│            └── Send: "Game started! Player1 guesses first"
│
GUESSING LOOP
│
├─→ Player1 sends: { type: "submit_guess", guess_number: 50 }
│      │
│      └─→ ws_handler.py: handle_submit_guess()
│            ├── game_logic.py: is_players_turn? ✓
│            ├── game_logic.py: is_valid_guess? ✓
│            ├── game_logic.py: process_guess(50, secret=65) → "higher"
│            ├── Switch turn to player2
│            └── Broadcast: "Player1 guessed 50 → Higher"
│
├─→ Player2's turn... same flow
│
├─→ Eventually someone guesses correctly
│      └─→ game_logic.py: process_guess(65, secret=65) → "correct"
│            ├── Status → FINISHED
│            ├── Winner set
│            └── Broadcast: "Game Over! Winner: Player1!"
```

---

## Redis Key Structure

| Key | Value | TTL |
|---|---|---|
| `guess_game:x7k2m9` | Full GameState JSON | 30 min |

That's it. One key per game. Compare this to VoteLive where you have
`poll:{id}:votes` (sorted set) + `poll:{id}:updates` (pub/sub channel).
The guessing game is simpler because there's no leaderboard to maintain.

---

## WebSocket Message Types (Complete Reference)

### Messages the FRONTEND sends:
| type | when | data fields |
|---|---|---|
| `join_room` | Player2 joins | player_id, player_name |
| `select_range` | Player1 picks range | player_id, range_min, range_max |
| `submit_secret` | Either player locks number | player_id, secret_number |
| `submit_guess` | Active player guesses | player_id, guess_number |
| `timer_expired` | 10s timer runs out | player_id |

### Messages the BACKEND sends:
| type | when | key data |
|---|---|---|
| `game_state` | After any state change | full sanitized state |
| `player_joined` | Player2 joins | player_name |
| `pick_your_number` | Range selected | range_min, range_max |
| `secret_locked` | Player locked their number | — |
| `opponent_ready` | Other player locked number | — |
| `game_started` | Both numbers locked | current_turn, first_player_name |
| `guess_result` | After a guess | guess_number, result (higher/lower) |
| `turn_skipped` | Timer expired | skipped_player, current_turn |
| `game_over` | Someone won | winner, both secrets revealed |
| `opponent_disconnected` | Other player left | — |
| `error` | Something went wrong | message |

---

## New Dependencies Needed

**None.** Everything uses libraries already in your `requirements.txt`:
- `fastapi` — endpoints + WebSocket
- `pydantic` — models
- `redis` — game state storage

This is a huge advantage of building inside VoteLive rather than from scratch.

---

## Testing Plan (What to Test)

| Test | File | What it checks |
|---|---|---|
| compare_guess correct | game_logic | Returns "correct" when guess == secret |
| compare_guess higher | game_logic | Returns "higher" when guess < secret |
| compare_guess lower | game_logic | Returns "lower" when guess > secret |
| is_valid_guess | game_logic | Range boundary checks |
| create_room | routes | Returns 200 + room key |
| validate existing room | routes | Returns room info |
| validate missing room | routes | Returns 404 |
| full game flow | ws_handler | Integration test: create → join → pick → guess → win |

---

## What's Next After Backend?

Once backend is done and tested:
1. Add routes to `main.py` (2 lines)
2. Test with Postman/curl for REST endpoints
3. Test with a WebSocket client (like Postman's WS feature) for game flow
4. Then move to frontend (CreateRoom → JoinRoom → GamePlay → GameResult)
5. Add a "Guessing Game" button on your VoteLive homepage

---

## One-Liner Summary For Interviews

> "I added a real-time 2-player number guessing game to VoteLive using the same
> stack — Redis for ephemeral game state with TTL auto-cleanup, WebSocket for
> bidirectional turn-based communication, and Pydantic for type-safe game state
> management. The backend validates every action server-side including turn
> order and timer enforcement to prevent cheating."