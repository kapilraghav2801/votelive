import time
from guess_game.models import GameState, GameStatus, Guess


def compare_guess(guess: int, secret: int) -> str:
    if guess == secret:
        return "correct"
    elif guess < secret:
        return "higher"
    else:
        return "lower"


def is_valid_number(number: int, game: GameState) -> bool:
    return game.range_min <= number <= game.range_max


def is_players_turn(player_id: str, game: GameState) -> bool:
    return game.current_turn == player_id


def is_turn_expired(game: GameState) -> bool:
    if game.turn_started_at is None:
        return False
    elapsed = time.time() - game.turn_started_at
    return elapsed > (game.guess_time_seconds + 2)


def get_player_and_opponent(player_id: str, game: GameState):
    if game.player1 and game.player1.player_id == player_id:
        return game.player1, game.player2
    elif game.player2 and game.player2.player_id == player_id:
        return game.player2, game.player1
    return None, None


def switch_turn(game: GameState) -> GameState:
    if game.player1 and game.current_turn == game.player1.player_id:
        game.current_turn = game.player2.player_id
    else:
        game.current_turn = game.player1.player_id
    game.turn_started_at = time.time()
    return game


def process_guess(player_id: str, player_name: str, guess_number: int, game: GameState) -> dict:
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
