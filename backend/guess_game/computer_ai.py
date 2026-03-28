import random
from guess_game.models import Difficulty, GameState


def computer_pick_secret(game: GameState) -> int:
    return random.randint(game.range_min, game.range_max)


def computer_guess_easy(game: GameState) -> int:
    return random.randint(game.range_min, game.range_max)


def computer_guess_medium(game: GameState) -> int:
    low = game.computer_known_low if game.computer_known_low is not None else game.range_min
    high = game.computer_known_high if game.computer_known_high is not None else game.range_max
    if low > high:
        low = game.range_min
        high = game.range_max
    if low == high:
        return low
    return random.randint(low, high)


def computer_guess_hard(game: GameState) -> int:
    low = game.computer_known_low if game.computer_known_low is not None else game.range_min
    high = game.computer_known_high if game.computer_known_high is not None else game.range_max
    if low > high:
        low = game.range_min
        high = game.range_max
    if low == high:
        return low
    return (low + high) // 2


def get_computer_guess(game: GameState) -> int:
    if game.difficulty == Difficulty.EASY:
        return computer_guess_easy(game)
    elif game.difficulty == Difficulty.MEDIUM:
        return computer_guess_medium(game)
    elif game.difficulty == Difficulty.HARD:
        return computer_guess_hard(game)
    else:
        return computer_guess_medium(game)


def update_computer_knowledge(game: GameState, guess: int, result: str) -> GameState:
    if game.difficulty == Difficulty.EASY:
        return game
    if game.computer_known_low is None:
        game.computer_known_low = game.range_min
    if game.computer_known_high is None:
        game.computer_known_high = game.range_max
    if result == "higher":
        game.computer_known_low = max(game.computer_known_low, guess + 1)
    elif result == "lower":
        game.computer_known_high = min(game.computer_known_high, guess - 1)
    return game
