from fastapi import APIRouter, HTTPException
from guess_game.models import (
    GameState, GameStatus, Player, Difficulty,
    StartGameRequest, StartGameResponse,
    SubmitSecretRequest, SubmitGuessRequest
)
from guess_game.game_logic import (
    is_valid_number, is_players_turn, is_turn_expired,
    process_guess, switch_turn, get_player_and_opponent
)
from guess_game.computer_ai import (
    computer_pick_secret, get_computer_guess,
    update_computer_knowledge
)
from auth import generate_room_key
import redis.asyncio as aioredis
import os
import time

router = APIRouter(prefix="/guess-game", tags=["guess-game"])


# --- Redis (lazy init) ---

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
        ex=1800
    )


async def load_game(room_key: str) -> GameState:
    r = get_redis()
    data = await r.get(f"guess_game:{room_key}")
    if data is None:
        return None
    return GameState.model_validate_json(data)


# --- Response builder ---

def build_response(event: str, game: GameState, **extras) -> dict:
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
        "range_min": game.range_min,
        "range_max": game.range_max,
    }

    if game.current_turn:
        if game.player1 and game.player1.player_id == game.current_turn:
            resp["current_turn_name"] = game.player1.name
        elif game.player2 and game.player2.player_id == game.current_turn:
            resp["current_turn_name"] = game.player2.name

    resp.update(extras)
    return resp


# ============================================================
# COMPUTER MODE (Phase 1)
# ============================================================

@router.post("/start")
async def start_game(req: StartGameRequest):
    r = get_redis()

    while True:
        room_key = generate_room_key()
        existing = await r.get(f"guess_game:{room_key}")
        if existing is None:
            break

    difficulty_names = {
        Difficulty.EASY: "CPU (Easy)",
        Difficulty.MEDIUM: "CPU (Medium)",
        Difficulty.HARD: "CPU (Hard)"
    }
    computer_name = difficulty_names.get(req.difficulty, "CPU")

    game = GameState(
        room_key=room_key,
        status=GameStatus.PICKING_NUMBERS,
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
            player_id=f"computer_{room_key}",
            name=computer_name,
            is_computer=True,
            secret_number=None,
            has_submitted_secret=True
        ),
        computer_known_low=req.range_min,
        computer_known_high=req.range_max
    )

    game.player2.secret_number = computer_pick_secret(game)

    await save_game(game)

    return StartGameResponse(
        room_key=room_key,
        message=f"Game created! Pick your secret number ({req.range_min}-{req.range_max})",
        computer_name=computer_name,
        range_min=req.range_min,
        range_max=req.range_max,
        who_goes_first=req.player_id
    )


@router.post("/{room_key}/secret")
async def submit_secret(room_key: str, req: SubmitSecretRequest):
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

    game.player1.secret_number = req.secret_number
    game.player1.has_submitted_secret = True

    game.status = GameStatus.PLAYING
    game.current_turn = game.player1.player_id
    game.turn_started_at = time.time()

    await save_game(game)

    return build_response(
        "game_started", game,
        message="Game started! Your turn to guess."
    )


@router.post("/{room_key}/guess")
async def submit_guess(room_key: str, req: SubmitGuessRequest):
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")

    if game.status != GameStatus.PLAYING:
        raise HTTPException(status_code=400, detail="Game is not in playing state")

    if not is_players_turn(req.player_id, game):
        raise HTTPException(status_code=400, detail="Not your turn")

    if is_turn_expired(game):
        game = switch_turn(game)
        computer_result = _do_computer_turn(game)
        await save_game(game)
        return build_response(
            "turn_skipped_then_computer_played", game,
            your_turn_skipped=True,
            skip_reason="Timer expired",
            computer_guess=computer_result.get("guess") if computer_result else None
        )

    if not is_valid_number(req.guess_number, game):
        raise HTTPException(
            status_code=400,
            detail=f"Guess must be between {game.range_min} and {game.range_max}"
        )

    human_player, _ = get_player_and_opponent(req.player_id, game)
    human_result = process_guess(
        req.player_id,
        human_player.name,
        req.guess_number,
        game
    )

    if human_result["game_over"]:
        await save_game(game)
        return build_response(
            "game_over", game,
            last_guess=human_result["guess"],
            you_won=True,
            message=f"You guessed it! The number was {req.guess_number}!"
        )

    computer_result = _do_computer_turn(game)

    if computer_result and computer_result.get("game_over"):
        await save_game(game)
        return build_response(
            "game_over", game,
            last_guess=human_result["guess"],
            computer_guess=computer_result.get("guess"),
            you_won=False,
            message=f"{game.player2.name} guessed your number!"
        )

    await save_game(game)

    return build_response(
        "round_complete", game,
        last_guess=human_result["guess"],
        computer_guess=computer_result.get("guess") if computer_result else None,
        message="Your turn again!"
    )


def _do_computer_turn(game: GameState) -> dict:
    if not game.is_vs_computer or game.player2 is None or not game.player2.is_computer:
        return None
    if game.status != GameStatus.PLAYING:
        return None

    computer_guess_number = get_computer_guess(game)

    computer_result = process_guess(
        game.player2.player_id,
        game.player2.name,
        computer_guess_number,
        game
    )

    if not computer_result["game_over"]:
        update_computer_knowledge(game, computer_guess_number, computer_result["result"])

    return computer_result


@router.get("/{room_key}/state")
async def get_game_state(room_key: str):
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return build_response("current_state", game)


# ============================================================
# 2-PLAYER MODE (Phase 2)
# ============================================================

@router.post("/create-room")
async def create_room(req: StartGameRequest):
    r = get_redis()

    while True:
        room_key = generate_room_key()
        existing = await r.get(f"guess_game:{room_key}")
        if existing is None:
            break

    game = GameState(
        room_key=room_key,
        status=GameStatus.WAITING_FOR_PLAYER2,
        is_vs_computer=False,
        range_min=req.range_min,
        range_max=req.range_max,
        player1=Player(
            player_id=req.player_id,
            name=req.player_name,
            is_computer=False
        )
    )

    await save_game(game)

    return {
        "room_key": room_key,
        "message": "Room created. Share this key with your opponent.",
        "range_min": req.range_min,
        "range_max": req.range_max
    }


@router.get("/{room_key}/validate")
async def validate_room(room_key: str):
    game = await load_game(room_key)
    if game is None:
        raise HTTPException(status_code=404, detail="Room not found")

    return {
        "room_key": room_key,
        "status": game.status.value,
        "player1_name": game.player1.name if game.player1 else None,
        "player2_name": game.player2.name if game.player2 else None,
        "is_vs_computer": game.is_vs_computer,
        "range_min": game.range_min,
        "range_max": game.range_max,
        "can_join": game.status == GameStatus.WAITING_FOR_PLAYER2
    }
