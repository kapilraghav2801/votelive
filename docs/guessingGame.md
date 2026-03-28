Step 1 — Room Creation. User1 opens Guessing Game, enters their name. Backend generates a room key (reuse your poll key logic). User1 shares this key with User2.

Step 2 — User2 Joins. User2 enters the room key + their name. Backend validates the key, adds them to the room. Both users are now connected via WebSocket to the same room.

Step 3 — User1 Picks Range & Secret Number. User1 selects a range (1–100, 1–500, 1–1000). Then picks a secret number within that range, say 94. Hits submit. Backend stores: {room_key, user1_secret: 94, range: [1,100]}. Backend sends a WebSocket message to User2: "User1 chose range 1–100. Now you pick your secret number."

Step 4 — User2 Picks Secret Number. User2 picks their number within the same range, say 65. Hits submit. Backend stores: {user2_secret: 65}. Backend notifies User1: "Both numbers locked. Game starts. You guess first."

Step 5 — Guessing Rounds (this is the core loop). User1 gets a 10-second countdown timer + a number input. They type a guess (say 50) and submit. Backend compares: is 50 == 65 (User2's secret)? No. So backend responds with "Lower" (meaning the real number is higher than 50). User1's turn ends. Now User2's turn unlocks — same thing, 10-second timer, they guess User1's secret. This alternates until someone guesses correctly OR a timer expires (which counts as a skipped turn and passes to the other player).

Step 6 — Win Condition. Whoever guesses the opponent's number first wins. Backend broadcasts the result to both users.

Backend Requirements Breakdown
Here's what your backend needs, piece by piece:

A) Data Storage (Redis is perfect here)
You need to store game state temporarily. A game lasts maybe 2–5 minutes, so Redis is ideal — no need for PostgreSQL. The key structure would look like guess_game:{room_key} and the value is a JSON object holding both players' names, their secret numbers, the range, whose turn it is, guess history, and the timer state. You set a TTL of maybe 30 minutes so dead games auto-clean.

B) WebSocket Events (the real backbone)
Your backend needs to handle these WebSocket message types — think of each as an "event":
create_room — User1 creates a game room. Server generates key, stores initial state in Redis, adds User1 to the WebSocket room.
join_room — User2 joins with the key. Server validates, adds them, notifies User1.
select_range — User1 picks the range. Server stores it, notifies User2.
submit_secret — Both users submit their secret number (one after another). Server stores each, and once both are in, broadcasts "game start."
submit_guess — The active player submits a guess. Server compares it against the opponent's secret. Responds with "correct" (game over), "higher", or "lower". Then switches the turn.
timer_expired — If a player doesn't guess in 10 seconds, frontend sends this. Server skips their turn.

C) Timer Management
The 10-second timer should run on the frontend (show the countdown UI), but the backend should also track when a turn started. This prevents cheating — if the backend sees a guess come in 15 seconds after the turn started, it rejects it or treats it as expired. Store turn_started_at timestamp in Redis.

D) API Endpoints (minimal, most logic is WebSocket)
You only need maybe 2 REST endpoints: one to create a room (returns room key), and one to validate a room key exists (so the join page can show an error before even connecting WebSocket). Everything else flows through WebSocket.

Folder Structure Plan

Inside your existing backend:
backend/
├── existing stuff (polls, etc.)
├── guess_game/
│   ├── __init__.py
│   ├── models.py        ← Pydantic models for game state
│   ├── routes.py         ← 2 REST endpoints (create/validate room)
│   ├── ws_handler.py     ← WebSocket event handler for the game
│   └── game_logic.py     ← Pure functions: compare guess, check win, etc.

Frontend (inside existing frontend repo):
frontend/src/
├── existing stuff
├── guess-game/
│   ├── CreateRoom.jsx
│   ├── JoinRoom.jsx
│   ├── GamePlay.jsx      ← timer, guess input, higher/lower display
│   └── GameResult.jsx