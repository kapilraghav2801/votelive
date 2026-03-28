from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class GameStatus(str, Enum):
    WAITING_FOR_PLAYER2 = "waiting_for_player2"
    SETUP = "setup"
    PICKING_RANGE = "picking_range"
    PICKING_NUMBERS = "picking_numbers"
    PLAYING = "playing"
    FINISHED = "finished"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Player(BaseModel):
    player_id: str
    name: str
    secret_number: Optional[int] = None
    has_submitted_secret: bool = False
    is_computer: bool = False


class Guess(BaseModel):
    player_id: str
    name: str
    number: int
    result: str  # "correct", "higher", "lower"


class GameState(BaseModel):
    room_key: str
    status: GameStatus = GameStatus.SETUP

    player1: Optional[Player] = None
    player2: Optional[Player] = None

    is_vs_computer: bool = False
    difficulty: Difficulty = Difficulty.MEDIUM
    range_min: int = 1
    range_max: int = 100
    guess_time_seconds: int = 30

    current_turn: Optional[str] = None
    turn_started_at: Optional[float] = None

    computer_known_low: Optional[int] = None
    computer_known_high: Optional[int] = None

    guesses: List[Guess] = []

    winner: Optional[str] = None
    winner_name: Optional[str] = None


# --- Request / Response schemas ---

class StartGameRequest(BaseModel):
    player_name: str
    player_id: str
    range_min: int = 1
    range_max: int = 100
    difficulty: Difficulty = Difficulty.MEDIUM


class StartGameResponse(BaseModel):
    room_key: str
    message: str
    computer_name: str
    range_min: int
    range_max: int
    who_goes_first: str


class SubmitSecretRequest(BaseModel):
    player_id: str
    secret_number: int


class SubmitGuessRequest(BaseModel):
    player_id: str
    guess_number: int
