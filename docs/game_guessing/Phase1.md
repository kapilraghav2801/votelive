# Guessing Game — Backend Plan v2 (Computer Mode First)

> **Build Order Changed:**
> Phase 1: Computer vs Player (REST-only, no WebSocket needed)
> Phase 2: 2-Player Mode (add WebSocket on top of Phase 1)
>
> This document covers Phase 1 completely with spoon-feeding.
> Phase 2 reuses 90% of the code — only adds ws_handler.py.

---

## Why Computer Mode First?

```
Phase 1 (Computer vs Player):
  ✅ No WebSocket complexity
  ✅ No waiting for opponent
  ✅ No disconnection handling
  ✅ Pure game logic + REST endpoints
  ✅ Testable with just curl/Postman
  ✅ Playable solo — instant fun

Phase 2 (2-Player, built AFTER Phase 1):
  ✅ game_logic.py is already tested
  ✅ models.py is already solid
  ✅ Only add networking layer (ws_handler.py)
  ✅ Debug network issues SEPARATELY from game bugs
```

---

## File Structure (Phase 1)

```
backend/
├── existing stuff (polls, votes, websocket)
├── guess_game/
│   ├── __init__.py          ← empty, makes it a Python package
│   ├── models.py            ← data shapes (what does a game look like?)
│   ├── game_logic.py         ← pure functions + computer AI (3 difficulty levels)
│   ├── routes.py             ← REST endpoints (full game flow, no WebSocket)
│   └── computer_ai.py        ← computer guessing strategies (separated for clarity)
```

Why `computer_ai.py` as a separate file?
Because the computer's guessing strategy is its own domain. Mixing it into
game_logic.py would make that file do two things: "how does the game work" AND
"how does the computer think". Separation = clarity.

---

## The 3 Difficulty Levels — How They Think

Before writing any code, let's understand what each level DOES.

### Easy Mode — "Drunk Random"

The computer picks a random number within the valid range every time.
It learns NOTHING from previous hints.

```
Secret = 65, Range = 1-100

Computer guesses 23  → "Higher"    (secret is higher)
Computer guesses 91  → "Lower"     (secret is lower)
Computer guesses 11  → "Higher"    (ignores that it already knows >23!)
Computer guesses 88  → "Lower"     (ignores that it already knows <91!)
...eventually stumbles onto 65 after ~30-50 guesses
```

Why is this "easy"? Because the computer wastes guesses. The player with
binary search thinking can win in 7 guesses while the computer flails around.

**Algorithm:** `random.randint(range_min, range_max)` — that's literally it.

### Medium Mode — "Smart Random"

The computer REMEMBERS the hints and narrows its range, but adds randomness
so it doesn't always pick the exact midpoint. Feels more human.

```
Secret = 65, Range = 1-100

Computer knows: valid range is 1-100
Computer guesses 40  → "Higher"    → narrows to 41-100
Computer guesses 78  → "Lower"     → narrows to 41-77
Computer guesses 55  → "Higher"    → narrows to 56-77
Computer guesses 71  → "Lower"     → narrows to 56-70
Computer guesses 62  → "Higher"    → narrows to 63-70
Computer guesses 67  → "Lower"     → narrows to 63-66
Computer guesses 65  → "Correct!"  (took ~7-12 guesses)
```

**Algorithm:** Pick a random number within the NARROWED range.
Not the midpoint (that's binary search), just any valid number.

### Hard Mode — "Binary Search Machine"

The computer always picks the exact midpoint of the valid range.
This is mathematically optimal — guarantees finding any number in
ceil(log2(range_size)) guesses.

```
Secret = 65, Range = 1-100

Computer guesses 50  → "Higher"    → narrows to 51-100
Computer guesses 75  → "Lower"     → narrows to 51-74
Computer guesses 62  → "Higher"    → narrows to 63-74
Computer guesses 68  → "Lower"     → narrows to 63-67
Computer guesses 65  → "Correct!"  (took exactly 5 guesses)
```

For 1-100: max 7 guesses. For 1-500: max 9. For 1-1000: max 10.

**Algorithm:** `(low + high) // 2` — classic binary search.

The player basically CANNOT beat hard mode unless they also use
binary search AND get lucky.

---

## File 1: `guess_game/models.py`

### What am I thinking?

Same as before, but now I need to add:
- `difficulty` field (easy/medium/hard)
- `is_vs_computer` flag (True = computer mode, False = 2-player)
- `computer_range_low` / `computer_range_high` — the computer's internal
  knowledge of where the secret could be (narrows after each hint)

The computer doesn't join the room like a player. The backend PRETENDS
to be a player. So `player2` will have `is_computer: True` and a
generated name like "CPU (Easy)".

### The Code

```python
# backend/guess_game/models.py

from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class GameStatus(str, Enum):
    """
    Every possible state a game can be in.
    
    The (str, Enum) means each value IS a string.
    So GameStatus.WAITING_FOR_PLAYER2 == "waiting_for_player2" is True.
    This matters because when we serialize to JSON, it becomes a plain string.
    Without `str`, JSON would show the enum name, not the value.
    
    Why not just use strings?
    Because game.status = "waitng_for_player2" (typo) would silently work
    with strings but CRASH immediately with Enum. Fail fast = easier debugging.
    
    Computer mode flow:
    SETUP → PICKING_NUMBERS → PLAYING → FINISHED
    (no WAITING_FOR_PLAYER2 because computer joins instantly)
    (no PICKING_RANGE step in frontend — user picks range during SETUP)
    
    2-Player mode flow (Phase 2):
    WAITING_FOR_PLAYER2 → PICKING_RANGE → PICKING_NUMBERS → PLAYING → FINISHED
    """
    WAITING_FOR_PLAYER2 = "waiting_for_player2"
    SETUP = "setup"                    # computer mode: user picks range + difficulty
    PICKING_RANGE = "picking_range"
    PICKING_NUMBERS = "picking_numbers"
    PLAYING = "playing"
    FINISHED = "finished"


class Difficulty(str, Enum):
    """
    Computer difficulty levels.
    
    Why an Enum?
    Same reason as GameStatus — prevents typos.
    If frontend sends difficulty="eazy", Pydantic rejects it immediately.
    
    Why str, Enum?
    So it serializes to "easy" in JSON, not "Difficulty.EASY".
    """
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Player(BaseModel):
    """
    Represents one player (human or computer).
    
    The computer is a Player too — it has a name, an ID, a secret number.
    The only difference is `is_computer = True`.
    
    Why model the computer as a Player?
    Because ALL the game logic (compare_guess, switch_turn, etc.) works
    on Player objects. If the computer was a special case, every function
    would need if/else for "is this a computer?" — messy.
    
    By making the computer a Player, the game_logic.py doesn't even KNOW
    it's playing against a computer. It just sees two Players.
    """
    player_id: str
    name: str
    secret_number: Optional[int] = None
    has_submitted_secret: bool = False
    is_computer: bool = False
    # is_computer is False by default.
    # Only set to True when backend creates the computer player.


class Guess(BaseModel):
    """
    One single guess attempt.
    
    player_id tells us WHO guessed (human or computer).
    number is WHAT they guessed.
    result is the outcome: "correct", "higher", or "lower".
    
    "higher" = the secret number is HIGHER than the guess (guess was too low)
    "lower"  = the secret number is LOWER than the guess (guess was too high)
    
    We store ALL guesses in order so the frontend can show a guess history
    like a chat log:
      You guessed 50 → Higher ↑
      CPU guessed 75 → Lower ↓
      You guessed 60 → Higher ↑
      ...
    """
    player_id: str
    name: str               # "Raghav" or "CPU (Hard)" — for display
    number: int
    result: str              # "correct", "higher", "lower"


class GameState(BaseModel):
    """
    The ENTIRE state of one game. Stored in Redis as JSON.
    
    Redis key: "guess_game:{room_key}"
    Redis value: this object serialized via .model_dump_json()
    Redis TTL: 30 minutes (auto-deleted after that)
    
    Every time ANYTHING happens in the game:
    1. Load this from Redis (deserialize JSON → GameState object)
    2. Modify the Python object
    3. Save back to Redis (serialize GameState → JSON string)
    
    This is called "read-modify-write". It's simple but has a subtle issue:
    if two requests hit at the exact same millisecond, they both read the
    same state, both modify it, and the second write overwrites the first.
    
    For 2 players this is extremely rare (humans can't click that fast).
    For computer mode it's impossible (everything is sequential in one request).
    """
    room_key: str
    status: GameStatus = GameStatus.SETUP
    
    # Players
    player1: Optional[Player] = None      # always the human
    player2: Optional[Player] = None      # human (Phase 2) or computer (Phase 1)
    
    # Game config
    is_vs_computer: bool = False          # True = computer mode
    difficulty: Difficulty = Difficulty.MEDIUM  # only matters when is_vs_computer=True
    range_min: int = 1
    range_max: int = 100
    guess_time_seconds: int = 10          # seconds per guess turn
    
    # Turn management
    current_turn: Optional[str] = None    # player_id of whose turn it is
    turn_started_at: Optional[float] = None  # unix timestamp
    
    # Computer's internal knowledge (for medium/hard AI)
    # These track what the computer KNOWS about the human's secret number
    computer_known_low: Optional[int] = None    # smallest the secret could be
    computer_known_high: Optional[int] = None   # largest the secret could be
    # Example: range 1-100, computer guesses 50, gets "higher"
    # → computer_known_low = 51, computer_known_high = 100
    # Next guess 75, gets "lower"
    # → computer_known_low = 51, computer_known_high = 74
    
    # Game history
    guesses: List[Guess] = []
    
    # Result
    winner: Optional[str] = None
    winner_name: Optional[str] = None


# ============================================================
# Request / Response schemas for REST endpoints
# ============================================================

class StartGameRequest(BaseModel):
    """
    What the frontend sends to start a computer game.
    
    One request creates the room AND starts the game — no waiting.
    This is different from 2-player mode where create and join are separate.
    
    Why combine them?
    In computer mode, there's no one to wait for. The user picks everything
    upfront (name, range, difficulty) and clicks "Start". The backend creates
    the room, creates the computer player, picks computer's secret number,
    and the game is immediately ready.
    """
    player_name: str           # "Raghav"
    player_id: str             # from localStorage
    range_min: int = 1         # default 1
    range_max: int = 100       # default 100, could be 500, 1000
    difficulty: Difficulty = Difficulty.MEDIUM


class StartGameResponse(BaseModel):
    """What the backend returns after creating the game."""
    room_key: str
    message: str
    computer_name: str         # "CPU (Hard)" — so frontend can show it
    range_min: int
    range_max: int
    who_goes_first: str        # player_id of first guesser


class SubmitSecretRequest(BaseModel):
    """Player submits their secret number."""
    player_id: str
    secret_number: int


class SubmitGuessRequest(BaseModel):
    """Player submits a guess."""
    player_id: str
    guess_number: int


class GameResponse(BaseModel):
    """
    Standard response after any game action (submit secret, submit guess).
    
    Why one response model for everything?
    Because after every action, the frontend needs the same info:
    - What happened? (event type)
    - What's the current game state? (whose turn, guess history)
    - Is the game over? (winner info)
    
    Instead of 5 different response models, one flexible model covers all cases.
    The `event` field tells the frontend what happened.
    """
    event: str                 # "secret_submitted", "guess_result", "game_over", etc.
    game_status: str           # current GameStatus value
    current_turn: Optional[str] = None
    current_turn_name: Optional[str] = None
    guess_time_seconds: int = 10
    
    # Guess info (filled after a guess)
    last_guess: Optional[dict] = None    # { player_name, number, result }
    computer_guess: Optional[dict] = None  # computer's response guess (if it's now computer's turn)
    
    # Guess history
    guesses: List[dict] = []
    
    # Game over info
    game_over: bool = False
    winner: Optional[str] = None
    winner_name: Optional[str] = None
    player1_secret: Optional[int] = None  # revealed at game end
    player2_secret: Optional[int] = None  # revealed at game end
    total_guesses: int = 0
```

### What if this file didn't exist?

You'd be passing raw dictionaries everywhere. Every typo becomes a silent bug.
`game["compouter_known_low"]` — no error, just `None`, and your AI makes
insane guesses. Pydantic catches these immediately.

---

## File 2: `guess_game/computer_ai.py`

### What am I thinking?

This file answers ONE question: "What number should the computer guess?"

Three strategies, one function that picks the right one based on difficulty.
Each strategy is a separate function so you can test them independently.

The computer also needs to PICK its secret number at game start.
That's also in this file — it's a computer decision.

### The Code

```python
# backend/guess_game/computer_ai.py

import random
from guess_game.models import Difficulty, GameState


def computer_pick_secret(game: GameState) -> int:
    """
    Computer picks its secret number at game start.
    
    Why not always pick the midpoint or edges?
    Because if the computer always picks 50 on a 1-100 range, the human
    learns this and always guesses 50 first. Randomness prevents gaming the system.
    
    We use the full range regardless of difficulty. The difficulty only affects
    how the computer GUESSES, not what number it picks.
    
    Why is this its own function?
    Because in Phase 2 (2-player mode), humans pick their own numbers.
    Having this as a function means we only call it when player2.is_computer == True.
    """
    return random.randint(game.range_min, game.range_max)


def computer_guess_easy(game: GameState) -> int:
    """
    Easy mode: Pure random within the ORIGINAL range.
    
    The computer doesn't learn from hints. It just picks any random number
    between range_min and range_max every single time.
    
    Why not even narrow the range?
    Because that's what makes it "easy". A random guesser on range 1-100
    has a 1% chance per guess. It'll take ~50-70 guesses on average.
    The human using any strategy at all will demolish this.
    
    Edge case: the computer might guess the same number twice.
    That's fine — it's supposed to be dumb.
    
    Time complexity: O(1) — just one random call.
    """
    return random.randint(game.range_min, game.range_max)


def computer_guess_medium(game: GameState) -> int:
    """
    Medium mode: Random within the NARROWED range.
    
    The computer remembers hints and narrows its search range, but
    instead of picking the optimal midpoint (that's hard mode), it
    picks a random number within the valid range.
    
    Example walkthrough:
      Range: 1-100, Secret: 65
      
      Known range: 1-100 → computer picks random 1-100, say 34
      Hint: "Higher" → Known range: 35-100
      Computer picks random 35-100, say 82
      Hint: "Lower" → Known range: 35-81
      Computer picks random 35-81, say 61
      Hint: "Higher" → Known range: 62-81
      ...continues until correct
    
    Average guesses for 1-100: ~10-15 (better than easy, worse than hard)
    
    Why does this feel more "human"?
    Because real humans don't do perfect binary search. They have hunches,
    biases ("I feel like it's high"), and sometimes just wing it within
    a reasonable range. Medium mode mimics this.
    
    Why use computer_known_low/high from GameState?
    Because these persist across turns. After each guess, we update them.
    Next time this function is called, it uses the narrowed range.
    """
    low = game.computer_known_low if game.computer_known_low is not None else game.range_min
    high = game.computer_known_high if game.computer_known_high is not None else game.range_max
    
    # Safety: if low > high somehow, reset (shouldn't happen but defensive coding)
    if low > high:
        low = game.range_min
        high = game.range_max
    
    # If only one number left, guess it
    if low == high:
        return low
    
    return random.randint(low, high)


def computer_guess_hard(game: GameState) -> int:
    """
    Hard mode: Binary search — always picks the exact midpoint.
    
    This is mathematically optimal. For any range of size N,
    binary search finds the answer in at most ceil(log2(N)) guesses.
    
    Range 1-100:  max 7 guesses  (log2(100) = 6.64, ceil = 7)
    Range 1-500:  max 9 guesses  (log2(500) = 8.97, ceil = 9)
    Range 1-1000: max 10 guesses (log2(1000) = 9.97, ceil = 10)
    
    The player CANNOT beat this consistently. The only way to win is
    if the player also uses binary search AND the alternating turns
    give the player lucky positioning.
    
    Example walkthrough:
      Range: 1-100, Secret: 65
      
      Known: 1-100 → mid = 50 → "Higher" → Known: 51-100
      Known: 51-100 → mid = 75 → "Lower"  → Known: 51-74
      Known: 51-74  → mid = 62 → "Higher" → Known: 63-74
      Known: 63-74  → mid = 68 → "Lower"  → Known: 63-67
      Known: 63-67  → mid = 65 → "Correct!" (5 guesses)
    
    Why (low + high) // 2 and not (low + high) / 2?
    // is integer division in Python. We need a whole number (can't guess 50.5).
    / would give a float, which would fail validation.
    """
    low = game.computer_known_low if game.computer_known_low is not None else game.range_min
    high = game.computer_known_high if game.computer_known_high is not None else game.range_max
    
    if low > high:
        low = game.range_min
        high = game.range_max
    
    if low == high:
        return low
    
    return (low + high) // 2


def get_computer_guess(game: GameState) -> int:
    """
    The main entry point. Picks the right strategy based on difficulty.
    
    This is the ONLY function that routes.py calls. It doesn't need to
    know HOW each difficulty works — it just says "give me a guess" and
    this function figures out which strategy to use.
    
    This is called the "Strategy Pattern" in software design:
    - One interface (get_computer_guess)
    - Multiple implementations (easy, medium, hard)
    - The caller doesn't know or care which one runs
    
    Why is this good?
    If you later add a "NIGHTMARE" difficulty, you add one function
    (computer_guess_nightmare) and one elif here. Nothing else changes.
    """
    if game.difficulty == Difficulty.EASY:
        return computer_guess_easy(game)
    elif game.difficulty == Difficulty.MEDIUM:
        return computer_guess_medium(game)
    elif game.difficulty == Difficulty.HARD:
        return computer_guess_hard(game)
    else:
        # fallback — should never happen if Pydantic validates the input
        return computer_guess_medium(game)


def update_computer_knowledge(game: GameState, guess: int, result: str) -> GameState:
    """
    After the computer guesses and gets a hint, update what it knows.
    
    This is called AFTER every computer guess (except "correct").
    
    Why is this separate from get_computer_guess()?
    Because guessing and learning are two different actions:
    1. get_computer_guess → "I think the number is 50"
    2. Game checks: 50 vs 65 → "higher"
    3. update_computer_knowledge → "OK, the number is between 51 and 100"
    
    If we combined them, the function would need to know the result
    before it returns the guess. That's backwards.
    
    Note: This function modifies the game state IN PLACE.
    That's OK because we always save_game() after calling this.
    
    IMPORTANT: This only runs for medium/hard.
    Easy mode doesn't learn (computer_known_low/high stay None).
    """
    if game.difficulty == Difficulty.EASY:
        # Easy doesn't learn — that's what makes it easy
        return game
    
    # Initialize knowledge if first guess
    if game.computer_known_low is None:
        game.computer_known_low = game.range_min
    if game.computer_known_high is None:
        game.computer_known_high = game.range_max
    
    if result == "higher":
        # Secret is HIGHER than our guess
        # So the secret is at least (guess + 1)
        game.computer_known_low = max(game.computer_known_low, guess + 1)
    elif result == "lower":
        # Secret is LOWER than our guess
        # So the secret is at most (guess - 1)
        game.computer_known_high = min(game.computer_known_high, guess - 1)
    
    return game


def update_computer_knowledge_from_player_guess(game: GameState, player_guess: int, result: str) -> GameState:
    """
    When the HUMAN guesses the COMPUTER'S number, the computer can also learn!
    
    Wait, what? Let me explain.
    
    The human guesses the COMPUTER's secret. The result tells the human
    whether the computer's secret is higher or lower. But the computer
    already KNOWS its own secret — so this result is useless to the computer.
    
    So why does this function exist?
    
    It DOESN'T learn from the human's guess about the computer's secret.
    It's here as a placeholder in case you want a future feature where
    the computer also tracks the human's guessing STRATEGY to counter it.
    
    For now, this is a no-op. But having the function signature ready means
    you don't need to refactor routes.py later.
    """
    # Currently a no-op — computer doesn't learn from human's guesses
    # about the computer's secret (the computer already knows its own number)
    return game
```

### What if this file didn't exist?

All AI logic would be inside routes.py. Your REST endpoint handler would be
200 lines of game flow + 100 lines of AI strategy mixed together.
When the medium AI makes weird guesses, you'd be debugging inside a massive
route handler instead of a clean, testable 10-line function.

---

## File 3: `guess_game/game_logic.py`

### What am I thinking?

Same pure functions as before. These work for BOTH computer mode AND
2-player mode. They don't know or care who's playing.

```python
# backend/guess_game/game_logic.py

import time
from guess_game.models import GameState, GameStatus, Guess


def compare_guess(guess: int, secret: int) -> str:
    """
    Core game mechanic. Compares a guess against the secret.
    
    Returns:
      "correct" — exact match
      "higher"  — secret is HIGHER than guess (guess too low)
      "lower"   — secret is LOWER than guess (guess too high)
    
    This function is called for BOTH human and computer guesses.
    It doesn't know who's guessing — it just compares two numbers.
    
    Examples:
      compare_guess(50, 65) → "higher"  (65 > 50)
      compare_guess(80, 65) → "lower"   (65 < 80)
      compare_guess(65, 65) → "correct"
    """
    if guess == secret:
        return "correct"
    elif guess < secret:
        return "higher"
    else:
        return "lower"


def is_valid_number(number: int, game: GameState) -> bool:
    """
    Checks if a number is within the game's range.
    Used for BOTH secret number validation AND guess validation.
    
    Why not trust the frontend's range check?
    Because someone can open DevTools → Console → send a fetch() request
    with guess_number: 99999. The frontend slider might limit 1-100,
    but the backend must independently verify.
    
    This is called "defense in depth" — validate at every layer.
    """
    return game.range_min <= number <= game.range_max


def is_players_turn(player_id: str, game: GameState) -> bool:
    """
    Checks if it's this player's turn.
    
    In computer mode, this prevents the human from guessing twice in a row
    by sending rapid requests. Even though the computer responds instantly,
    the turn order must be enforced.
    """
    return game.current_turn == player_id


def is_turn_expired(game: GameState) -> bool:
    """
    Checks if the 10-second timer has elapsed.
    
    The 2-second buffer (grace period) exists because:
    1. The user clicks "Submit" at 9.8 seconds
    2. The HTTP request takes 0.5 seconds to reach the server
    3. Without buffer: server sees 10.3 seconds elapsed → rejects → bad UX
    4. With 2s buffer: server sees 10.3 seconds < 12 → accepts → good UX
    
    In computer mode, the timer only applies to the HUMAN's turn.
    The computer "guesses" instantly (within the same request).
    """
    if game.turn_started_at is None:
        return False
    elapsed = time.time() - game.turn_started_at
    return elapsed > (game.guess_time_seconds + 2)


def get_player_and_opponent(player_id: str, game: GameState):
    """
    Given a player_id, returns (this_player, opponent_player) tuple.
    
    Why return both?
    Because most operations need both:
    - "Whose secret do I compare against?" → opponent's
    - "Whose turn is next?" → opponent's
    - "What name to show in the result?" → this player's
    
    Returns (Player, Player) or (None, None) if player_id not found.
    """
    if game.player1 and game.player1.player_id == player_id:
        return game.player1, game.player2
    elif game.player2 and game.player2.player_id == player_id:
        return game.player2, game.player1
    return None, None


def switch_turn(game: GameState) -> GameState:
    """
    Switches active turn to the other player. Resets timer.
    
    In computer mode, when we switch to the computer's turn,
    routes.py will immediately call get_computer_guess() and process it.
    The computer doesn't "wait" — its turn happens within the same HTTP request.
    
    So the flow is:
    1. Human submits guess → result is "higher"
    2. switch_turn() → now it's computer's turn
    3. routes.py sees it's computer's turn → calls get_computer_guess()
    4. Computer guesses → result is "lower"
    5. switch_turn() → now it's human's turn again
    6. Response sent to frontend with BOTH guesses (human's and computer's)
    
    The human never waits for the computer. It all happens in one request-response.
    """
    if game.player1 and game.current_turn == game.player1.player_id:
        game.current_turn = game.player2.player_id
    else:
        game.current_turn = game.player1.player_id
    game.turn_started_at = time.time()
    return game


def process_guess(player_id: str, player_name: str, guess_number: int, game: GameState) -> dict:
    """
    Processes a single guess. Works for both human and computer.
    
    Returns a dict describing what happened:
    {
      "result": "correct" | "higher" | "lower",
      "guess": { player_id, name, number, result },
      "game_over": True | False,
      "winner_id": player_id | None,
      "winner_name": name | None
    }
    
    Why a dict and not modify game directly?
    Because the caller (routes.py) needs to know the RESULT to decide
    what to do next:
    - If "correct" → send game_over response
    - If "higher/lower" → switch turn, maybe trigger computer's turn
    
    The function DOES modify game (appends to guesses, sets winner/status),
    but it ALSO returns the result for the caller to use.
    """
    _, opponent = get_player_and_opponent(player_id, game)
    if opponent is None:
        return {"result": "error", "game_over": False}
    
    result = compare_guess(guess_number, opponent.secret_number)
    
    guess_record = Guess(
        player_id=player_id,
        name=player_name,
        number=guess_number,
        result=result
    )
    game.guesses.append(guess_record)
    
    if result == "correct":
        game.status = GameStatus.FINISHED
        game.winner = player_id
        game.winner_name = player_name
        return {
            "result": "correct",
            "guess": guess_record.model_dump(),
            "game_over": True,
            "winner_id": player_id,
            "winner_name": player_name
        }
    else:
        game = switch_turn(game)
        return {
            "result": result,
            "guess": guess_record.model_dump(),
            "game_over": False,
            "winner_id": None,
            "winner_name": None
        }
```

---

## File 4: `guess_game/routes.py`

### What am I thinking?

This is the heart of Phase 1. Everything runs through REST endpoints.
No WebSocket. The flow is:

```
1. POST /guess-game/start     → create game, computer joins instantly
2. POST /guess-game/{key}/secret  → human picks their secret number
3. POST /guess-game/{key}/guess   → human guesses, computer auto-responds
4. GET  /guess-game/{key}/state   → get current game state (for page refresh)
```

The clever part: when the human guesses and it's wrong, the backend
IMMEDIATELY makes the computer's guess in the same request and returns
BOTH results. The human never waits.

### The Code

```python
# backend/guess_game/routes.py

from fastapi import APIRouter, HTTPException
from guess_game.models import (
    GameState, GameStatus, Player, Difficulty,
    StartGameRequest, StartGameResponse,
    SubmitSecretRequest, SubmitGuessRequest, GameResponse
)
from guess_game.game_logic import (
    is_valid_number, is_players_turn, is_turn_expired,
    process_guess, switch_turn, get_player_and_opponent
)
from guess_game.computer_ai import (
    computer_pick_secret, get_computer_guess,
    update_computer_knowledge, update_computer_knowledge_from_player_guess
)
from auth import generate_room_key
import redis.asyncio as aioredis
import os
import time

router = APIRouter(prefix="/guess-game", tags=["guess-game"])


# --- Redis connection (lazy init, same pattern as your votes.py) ---

_redis = None

def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True
        )
    return _redis

def reset_redis():
    global _redis
    _redis = None


# --- Redis helpers ---

async def save_game(game: GameState):
    r = get_redis()
    await r.set(
        f"guess_game:{game.room_key}",
        game.model_dump_json(),
        ex=1800  # 30 min TTL
    )

async def load_game(room_key: str) -> GameState:
    r = get_redis()
    data = await r.get(f"guess_game:{room_key}")
    if data is None:
        return None
    return GameState.model_validate_json(data)


# --- Helper to build standard response ---

def build_response(event: str, game: GameState, **extras) -> dict:
    """
    Builds a standardized response dict from game state.
    
    Why a helper function?
    Because every endpoint returns the same shape of data.
    Without this, each endpoint would have 20 lines of response construction.
    DRY principle — Don't Repeat Yourself.
    
    **extras allows each endpoint to add extra fields:
      build_response("guess_result", game, last_guess={...}, computer_guess={...})
    """
    resp = {
        "event": event,
        "game_status": game.status.value,
        "current_turn": game.current_turn,
        "current_turn_name": None,
        "guess_time_seconds": game.guess_time_seconds,
        "guesses": [g.model_dump() for g in game.guesses],
        "game_over": game.status == GameStatus.FINISHED,
        "winner": game.winner,
        "winner_name": game.winner_name,
        "total_guesses": len(game.guesses),
        "player1_secret": game.player1.secret_number if game.status == GameStatus.FINISHED else None,
        "player2_secret": game.player2.secret_number if game.status == GameStatus.FINISHED else None,
    }
    
    # Resolve current turn player name
    if game.current_turn:
        if game.player1 and game.player1.player_id == game.current_turn:
            resp["current_turn_name"] = game.player1.name
        elif game.player2 and game.player2.player_id == game.current_turn:
            resp["current_turn_name"] = game.player2.name
    
    resp.update(extras)
    return resp


# ============================================================
# ENDPOINT 1: Start a new game against the computer
# ============================================================

@router.post("/start")
async def start_game(req: StartGameRequest):
    """
    Creates a new game room with the computer as opponent.
    
    What happens in this ONE request:
    1. Generate unique room key
    2. Create human player (player1)
    3. Create computer player (player2) with auto-generated name
    4. Computer picks its secret number immediately
    5. Save to Redis
    6. Return room key + game info
    
    After this, the frontend shows the "pick your secret number" screen.
    The computer has already picked its number — it doesn't need to wait.
    
    Why does the computer pick first?
    Because the computer doesn't "think about it". It picks instantly.
    The human picks after seeing the range. This order doesn't matter
    strategically because neither player knows the other's number.
    """
    r = get_redis()
    
    # Generate unique room key (same collision-check pattern as your polls.py)
    while True:
        room_key = generate_room_key()
        existing = await r.get(f"guess_game:{room_key}")
        if existing is None:
            break
    
    # Create computer player with difficulty-specific name
    # These names appear in the UI guess history
    difficulty_names = {
        Difficulty.EASY: "CPU (Easy)",
        Difficulty.MEDIUM: "CPU (Medium)",
        Difficulty.HARD: "CPU (Hard)"
    }
    computer_name = difficulty_names.get(req.difficulty, "CPU")
    
    # Build initial game state
    game = GameState(
        room_key=room_key,
        status=GameStatus.PICKING_NUMBERS,  # skip SETUP, go straight to number picking
        is_vs_computer=True,
        difficulty=req.difficulty,
        range_min=req.range_min,
        range_max=req.range_max,
        player1=Player(
            player_id=req.player_id,
            name=req.player_name,
            is_computer=False
        ),
        player2=Player(
            player_id=f"computer_{room_key}",  # unique ID for the computer
            name=computer_name,
            is_computer=True,
            secret_number=None,  # will be set below
            has_submitted_secret=True  # computer is always "ready"
        ),
        # Initialize computer's knowledge for medium/hard AI
        computer_known_low=req.range_min,
        computer_known_high=req.range_max
    )
    
    # Computer picks its secret number
    game.player2.secret_number = computer_pick_secret(game)
    
    await save_game(game)
    
    return StartGameResponse(
        room_key=room_key,
        message=f"Game created! Pick your secret number ({req.range_min}-{req.range_max})",
        computer_name=computer_name,
        range_min=req.range_min,
        range_max=req.range_max,
        who_goes_first=req.player_id  # human always guesses first
    )


# ============================================================
# ENDPOINT 2: Human submits their secret number
# ============================================================

@router.post("/{room_key}/secret")
async def submit_secret(room_key: str, req: SubmitSecretRequest):
    """
    Human picks their secret number. Game starts immediately after.
    
    Validation:
    1. Room must exist
    2. Game must be in PICKING_NUMBERS status
    3. Number must be within range
    4. Must be player1 (the human)
    
    After this, the game transitions to PLAYING.
    The computer has already picked its number (during /start).
    So as soon as the human picks theirs, the game is live.
    
    The response tells the frontend: "Game started, your turn to guess!"
    """
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    
    if game.status != GameStatus.PICKING_NUMBERS:
        raise HTTPException(status_code=400, detail="Game is not in number picking phase")
    
    if game.player1.player_id != req.player_id:
        raise HTTPException(status_code=403, detail="Not your game")
    
    if not is_valid_number(req.secret_number, game):
        raise HTTPException(
            status_code=400,
            detail=f"Number must be between {game.range_min} and {game.range_max}"
        )
    
    # Lock in human's secret
    game.player1.secret_number = req.secret_number
    game.player1.has_submitted_secret = True
    
    # Both players now have secrets → START THE GAME
    game.status = GameStatus.PLAYING
    game.current_turn = game.player1.player_id  # human guesses first
    game.turn_started_at = time.time()
    
    await save_game(game)
    
    return build_response(
        "game_started", game,
        message="Game started! Your turn to guess."
    )


# ============================================================
# ENDPOINT 3: Human submits a guess (+ computer auto-responds)
# ============================================================

@router.post("/{room_key}/guess")
async def submit_guess(room_key: str, req: SubmitGuessRequest):
    """
    THE MAIN GAME ENDPOINT. Called every time the human guesses.
    
    Flow (this is where the magic happens):
    
    1. Human submits guess (e.g., 50)
    2. Compare 50 vs computer's secret (65) → "higher"
    3. Record human's guess in history
    4. Switch turn to computer
    5. Computer generates its guess using AI strategy
    6. Compare computer's guess vs human's secret
    7. Record computer's guess in history
    8. Switch turn back to human
    9. Return BOTH results in one response
    
    Why process the computer's turn in the same request?
    
    Option A (what we're doing):
      Human guesses → response includes computer's guess → instant
      One HTTP request = one round (human + computer)
    
    Option B (alternative):
      Human guesses → response says "computer's turn"
      Frontend waits 2 seconds (fake thinking time)
      Frontend sends another request to get computer's guess
      Two HTTP requests = one round
    
    We chose Option A because:
    - Simpler (fewer requests)
    - No fake delay needed
    - No risk of the frontend "forgetting" to ask for computer's guess
    - The response has everything the frontend needs to update the UI
    
    If you want the computer to appear to "think", add a setTimeout
    on the FRONTEND before showing the computer's guess. Backend stays fast.
    
    EDGE CASES handled:
    - Human's guess is correct → game over, no computer turn
    - Computer's guess is correct → game over, computer wins
    - Timer expired → skip human's turn (but computer still plays)
    """
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    
    if game.status != GameStatus.PLAYING:
        raise HTTPException(status_code=400, detail="Game is not in playing state")
    
    # Verify it's the human's turn
    if not is_players_turn(req.player_id, game):
        raise HTTPException(status_code=400, detail="Not your turn")
    
    # Check timer
    if is_turn_expired(game):
        # Human took too long — skip their turn
        game = switch_turn(game)
        
        # Now it's computer's turn — process it immediately
        computer_result = _do_computer_turn(game)
        await save_game(game)
        
        return build_response(
            "turn_skipped_then_computer_played", game,
            your_turn_skipped=True,
            skip_reason="Timer expired",
            computer_guess=computer_result
        )
    
    # Validate guess range
    if not is_valid_number(req.guess_number, game):
        raise HTTPException(
            status_code=400,
            detail=f"Guess must be between {game.range_min} and {game.range_max}"
        )
    
    # ---- PROCESS HUMAN'S GUESS ----
    human_player, _ = get_player_and_opponent(req.player_id, game)
    human_result = process_guess(
        req.player_id,
        human_player.name,
        req.guess_number,
        game
    )
    
    # Let computer learn from human's guess pattern (currently no-op, future feature)
    update_computer_knowledge_from_player_guess(game, req.guess_number, human_result["result"])
    
    # If human guessed correctly → game over!
    if human_result["game_over"]:
        await save_game(game)
        return build_response(
            "game_over", game,
            last_guess=human_result["guess"],
            you_won=True,
            message=f"You guessed it! The number was {req.guess_number}!"
        )
    
    # ---- HUMAN DIDN'T WIN — NOW COMPUTER'S TURN ----
    # At this point, switch_turn was already called inside process_guess()
    # So game.current_turn is now the computer's player_id
    
    computer_result = _do_computer_turn(game)
    
    # If computer guessed correctly → game over, computer wins
    if computer_result and computer_result.get("game_over"):
        await save_game(game)
        return build_response(
            "game_over", game,
            last_guess=human_result["guess"],
            computer_guess=computer_result.get("guess"),
            you_won=False,
            message=f"{game.player2.name} guessed your number!"
        )
    
    # ---- NEITHER WON — back to human's turn ----
    # switch_turn was called inside process_guess() for the computer too
    # So game.current_turn is back to the human's player_id
    
    await save_game(game)
    
    return build_response(
        "round_complete", game,
        last_guess=human_result["guess"],
        computer_guess=computer_result.get("guess") if computer_result else None,
        message="Your turn again!"
    )


def _do_computer_turn(game: GameState) -> dict:
    """
    Executes the computer's turn. Called internally, not an endpoint.
    
    Why a private function (underscore prefix)?
    Because this is never called directly by the frontend.
    It's called by submit_guess() when it's the computer's turn.
    The underscore is a Python convention meaning "internal use only".
    
    Returns the result dict from process_guess(), or None if something went wrong.
    """
    if not game.is_vs_computer:
        return None
    
    if game.player2 is None or not game.player2.is_computer:
        return None
    
    if game.status != GameStatus.PLAYING:
        return None
    
    # Generate computer's guess based on difficulty
    computer_guess_number = get_computer_guess(game)
    
    # Process the guess
    computer_result = process_guess(
        game.player2.player_id,
        game.player2.name,
        computer_guess_number,
        game
    )
    
    # Update computer's knowledge based on the hint it received
    if not computer_result["game_over"]:
        update_computer_knowledge(game, computer_guess_number, computer_result["result"])
    
    return computer_result


# ============================================================
# ENDPOINT 4: Get current game state (for page refresh)
# ============================================================

@router.get("/{room_key}/state")
async def get_game_state(room_key: str):
    """
    Returns the current game state (sanitized — no secrets revealed).
    
    When does the frontend call this?
    1. Page refresh during a game
    2. Reconnecting after network drop
    3. Initial load when opening a game URL directly
    
    Why sanitize (hide secrets)?
    Because this is a GET endpoint. Anyone can call it. If it returned
    the raw game state with both secret numbers, the player could just
    open the URL in their browser and see the computer's secret.
    
    Secrets are ONLY revealed when game.status == FINISHED.
    """
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    
    return build_response("current_state", game)
```

---

## File 5: `guess_game/__init__.py`

```python
# Empty. Makes Python treat guess_game/ as a package.
```

---

## File 6: Changes to `main.py` (just 2 lines)

```python
# Add this import at the top with your other imports:
from guess_game.routes import router as guess_game_router

# Add this line after your existing app.include_router() calls:
app.include_router(guess_game_router)
```

That's it. No WebSocket router needed for Phase 1.

---

## Complete Game Flow (Computer Mode)

```
FRONTEND                              BACKEND
────────                              ───────

User opens Guess Game page
User enters name: "Raghav"
User selects range: 1-100
User selects difficulty: Hard
User clicks "Start Game"
                │
                ├──→ POST /guess-game/start
                │      {
                │        player_name: "Raghav",
                │        player_id: "abc123",
                │        range_min: 1,
                │        range_max: 100,
                │        difficulty: "hard"
                │      }
                │                │
                │                ├── generate room key → "x7k2m9"
                │                ├── create Player1 (Raghav)
                │                ├── create Player2 (CPU Hard)
                │                ├── computer picks secret → 73
                │                ├── save to Redis
                │                └── return { room_key: "x7k2m9" }
                │
User sees: "Pick your secret number (1-100)"
User picks: 42
User clicks "Lock In"
                │
                ├──→ POST /guess-game/x7k2m9/secret
                │      { player_id: "abc123", secret_number: 42 }
                │                │
                │                ├── validate number in range ✓
                │                ├── lock in player1.secret = 42
                │                ├── status → PLAYING
                │                ├── current_turn → player1
                │                └── return { event: "game_started" }
                │
User sees: "Game started! Your turn to guess."
User sees: number keyboard 1-100
User sees: 10-second countdown timer
User types: 50
User clicks "Guess"
                │
                ├──→ POST /guess-game/x7k2m9/guess
                │      { player_id: "abc123", guess_number: 50 }
                │                │
                │                ├── validate it's player1's turn ✓
                │                ├── validate timer not expired ✓
                │                ├── validate 50 in range 1-100 ✓
                │                │
                │                ├── HUMAN GUESS: compare 50 vs 73 → "higher"
                │                ├── record: { Raghav, 50, "higher" }
                │                ├── switch turn → computer
                │                │
                │                ├── COMPUTER GUESS (Hard = binary search)
                │                │   known range: 1-100 → midpoint = 50
                │                │   compare 50 vs 42 → "lower"
                │                │   record: { CPU (Hard), 50, "lower" }
                │                │   update knowledge: 1-49
                │                │   switch turn → player1
                │                │
                │                └── return {
                │                      event: "round_complete",
                │                      last_guess: { "Raghav", 50, "higher" },
                │                      computer_guess: { "CPU (Hard)", 50, "lower" },
                │                      current_turn: "abc123"
                │                    }
                │
User sees guess history:
  "You guessed 50 → Higher ↑"
  "CPU (Hard) guessed 50 → Lower ↓"
User sees: "Your turn!" + fresh 10-second timer

...continues for several rounds...

Eventually user guesses 73:
                │
                ├──→ POST /guess-game/x7k2m9/guess
                │      { player_id: "abc123", guess_number: 73 }
                │                │
                │                ├── compare 73 vs 73 → "correct"!
                │                ├── status → FINISHED
                │                ├── winner → "abc123" (Raghav)
                │                │
                │                └── return {
                │                      event: "game_over",
                │                      you_won: true,
                │                      player1_secret: 42,
                │                      player2_secret: 73,
                │                      total_guesses: 14,
                │                      winner_name: "Raghav"
                │                    }
                │
User sees: "🏆 You won! The number was 73"
User sees: full guess history + both secrets revealed
User sees: "Play Again" button
```

---

## Testing Plan (Phase 1)

Tests you can write in `backend/tests/test_guess_game.py`:

| # | Test | What it proves |
|---|---|---|
| 1 | compare_guess(50, 65) == "higher" | Core logic works |
| 2 | compare_guess(80, 65) == "lower" | Core logic works |
| 3 | compare_guess(65, 65) == "correct" | Core logic works |
| 4 | is_valid_number(0, game_1_100) == False | Boundary check |
| 5 | is_valid_number(101, game_1_100) == False | Boundary check |
| 6 | computer_guess_hard always returns midpoint | Binary search works |
| 7 | computer_guess_easy returns number in range | Random is valid |
| 8 | update_computer_knowledge narrows range | AI learning works |
| 9 | POST /guess-game/start returns room_key | Room creation works |
| 10 | POST /guess-game/{key}/secret validates range | Input validation |
| 11 | POST /guess-game/{key}/guess full round | Integration test |
| 12 | POST /guess-game/{key}/guess → game_over | Win detection works |

---

## What Phase 2 Adds (2-Player Mode, Later)

When you're ready for multiplayer, you add ONE file:

```
guess_game/
├── ws_handler.py     ← NEW (WebSocket for 2-player real-time)
```

And modify routes.py to add:
- `POST /guess-game/create-room` (create without computer)
- `GET /guess-game/{key}/validate` (check if room joinable)

The game_logic.py and computer_ai.py don't change AT ALL.
That's the beauty of building Computer mode first.

---

## Interview One-Liner

> "I built a number guessing game with 3 AI difficulty levels inside VoteLive.
> Easy uses pure random, Medium uses narrowing random, Hard uses binary search —
> which I can explain mathematically as O(log n) guaranteed convergence.
> Game state lives in Redis with TTL auto-cleanup, and the computer's turn
> executes within the same HTTP request as the player's guess, so there's
> zero perceived latency."