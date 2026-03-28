from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from guess_game.models import GameState, GameStatus, Player
from guess_game.routes import load_game, save_game
from guess_game.game_logic import (
    is_valid_number, is_players_turn, is_turn_expired,
    process_guess, switch_turn, get_player_and_opponent
)
import json
import time

router = APIRouter()

game_connections: dict = {}


async def send_to_player(room_key: str, player_id: str, message: dict):
    connections = game_connections.get(room_key, {})
    ws = connections.get(player_id)
    if ws:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            connections.pop(player_id, None)


async def send_to_both(room_key: str, message: dict):
    connections = game_connections.get(room_key, {})
    dead = []
    for pid, ws in connections.items():
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.append(pid)
    for pid in dead:
        connections.pop(pid, None)


async def send_game_state(room_key: str, game: GameState):
    base = {
        "type": "game_state",
        "status": game.status.value,
        "room_key": game.room_key,
        "range_min": game.range_min,
        "range_max": game.range_max,
        "current_turn": game.current_turn,
        "guess_time_seconds": game.guess_time_seconds,
        "guesses": [g.model_dump() for g in game.guesses],
        "winner": game.winner,
        "winner_name": game.winner_name,
    }

    def player_info(player, hide_secret=True):
        if player is None:
            return None
        return {
            "player_id": player.player_id,
            "name": player.name,
            "has_submitted_secret": player.has_submitted_secret,
            "secret_number": None if (hide_secret and game.status != GameStatus.FINISHED) else player.secret_number
        }

    if game.player1:
        msg = {**base, "player1": player_info(game.player1, hide_secret=False), "player2": player_info(game.player2, hide_secret=True)}
        await send_to_player(room_key, game.player1.player_id, msg)

    if game.player2:
        msg = {**base, "player1": player_info(game.player1, hide_secret=True), "player2": player_info(game.player2, hide_secret=False)}
        await send_to_player(room_key, game.player2.player_id, msg)


async def handle_join_room(room_key: str, data: dict, ws: WebSocket):
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

    game.player2 = Player(player_id=player_id, name=player_name)
    game.status = GameStatus.PICKING_RANGE

    if room_key not in game_connections:
        game_connections[room_key] = {}
    game_connections[room_key][player_id] = ws

    await save_game(game)
    await send_to_player(room_key, game.player1.player_id, {"type": "player_joined", "player_name": player_name})
    await send_game_state(room_key, game)


async def handle_select_range(room_key: str, data: dict):
    game = await load_game(room_key)
    if game is None or game.status != GameStatus.PICKING_RANGE:
        return

    player_id = data.get("player_id")
    if player_id != game.player1.player_id:
        await send_to_player(room_key, player_id, {"type": "error", "message": "Only the host can select the range"})
        return

    game.range_min = data.get("range_min", 1)
    game.range_max = data.get("range_max", 100)
    game.status = GameStatus.PICKING_NUMBERS

    await save_game(game)
    await send_to_both(room_key, {
        "type": "pick_your_number",
        "range_min": game.range_min,
        "range_max": game.range_max,
        "message": f"Choose your secret number between {game.range_min} and {game.range_max}"
    })
    await send_game_state(room_key, game)


async def handle_submit_secret(room_key: str, data: dict):
    game = await load_game(room_key)
    if game is None or game.status != GameStatus.PICKING_NUMBERS:
        return

    player_id = data.get("player_id")
    secret = data.get("secret_number")

    if secret is None or not is_valid_number(secret, game):
        await send_to_player(room_key, player_id, {
            "type": "error", "message": f"Number must be between {game.range_min} and {game.range_max}"
        })
        return

    if game.player1 and game.player1.player_id == player_id:
        game.player1.secret_number = secret
        game.player1.has_submitted_secret = True
    elif game.player2 and game.player2.player_id == player_id:
        game.player2.secret_number = secret
        game.player2.has_submitted_secret = True
    else:
        return

    await save_game(game)

    await send_to_player(room_key, player_id, {"type": "secret_locked", "message": "Your number is locked in!"})

    _, opponent = get_player_and_opponent(player_id, game)
    if opponent:
        await send_to_player(room_key, opponent.player_id, {"type": "opponent_ready", "message": "Your opponent has chosen their number"})

    if (game.player1 and game.player1.has_submitted_secret and
            game.player2 and game.player2.has_submitted_secret):
        game.status = GameStatus.PLAYING
        game.current_turn = game.player1.player_id
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
    game = await load_game(room_key)
    if game is None or game.status != GameStatus.PLAYING:
        return

    player_id = data.get("player_id")
    guess_number = data.get("guess_number")

    if not is_players_turn(player_id, game):
        await send_to_player(room_key, player_id, {"type": "error", "message": "Not your turn!"})
        return

    if is_turn_expired(game):
        skipped = game.current_turn
        game = switch_turn(game)
        await save_game(game)
        await send_to_both(room_key, {"type": "turn_skipped", "reason": "timer_expired", "skipped_player": skipped, "current_turn": game.current_turn, "guess_time_seconds": game.guess_time_seconds})
        await send_game_state(room_key, game)
        return

    if not is_valid_number(guess_number, game):
        await send_to_player(room_key, player_id, {"type": "error", "message": f"Guess must be between {game.range_min} and {game.range_max}"})
        return

    player, _ = get_player_and_opponent(player_id, game)
    result = process_guess(player_id, player.name, guess_number, game)
    await save_game(game)

    if result["game_over"]:
        await send_to_both(room_key, {
            "type": "game_over", "winner": result["winner_id"], "winner_name": result["winner_name"],
            "winning_guess": guess_number, "total_guesses": len(game.guesses),
            "player1_secret": game.player1.secret_number, "player2_secret": game.player2.secret_number,
        })
        await send_game_state(room_key, game)
        game_connections.pop(room_key, None)
    else:
        await send_to_both(room_key, {
            "type": "guess_result", "player_id": player_id, "player_name": player.name,
            "guess_number": guess_number, "result": result["result"],
            "current_turn": game.current_turn, "guess_time_seconds": game.guess_time_seconds
        })
        await send_game_state(room_key, game)


async def handle_timer_expired(room_key: str, data: dict):
    game = await load_game(room_key)
    if game is None or game.status != GameStatus.PLAYING:
        return
    if not is_turn_expired(game):
        return

    skipped = game.current_turn
    game = switch_turn(game)
    await save_game(game)
    await send_to_both(room_key, {"type": "turn_skipped", "reason": "timer_expired", "skipped_player": skipped, "current_turn": game.current_turn, "guess_time_seconds": game.guess_time_seconds})
    await send_game_state(room_key, game)


@router.websocket("/ws/guess-game/{room_key}")
async def guess_game_websocket(room_key: str, websocket: WebSocket):
    player_id = websocket.query_params.get("player_id")
    if not player_id:
        await websocket.close(code=4001)
        return

    game = await load_game(room_key)
    if game is None:
        await websocket.close(code=4004)
        return

    await websocket.accept()

    if room_key not in game_connections:
        game_connections[room_key] = {}
    game_connections[room_key][player_id] = websocket

    await send_game_state(room_key, game)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

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
                await websocket.send_text(json.dumps({"type": "error", "message": f"Unknown type: {msg_type}"}))

    except WebSocketDisconnect:
        if room_key in game_connections:
            game_connections[room_key].pop(player_id, None)
            for pid, ws in game_connections.get(room_key, {}).items():
                try:
                    await ws.send_text(json.dumps({"type": "opponent_disconnected", "message": "Your opponent disconnected"}))
                except Exception:
                    pass
            if not game_connections.get(room_key):
                game_connections.pop(room_key, None)
