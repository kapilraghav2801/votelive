import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from guess_game.models import GameState, GameStatus, Player, Difficulty, Guess
from guess_game.game_logic import (
    compare_guess, is_valid_number, is_players_turn,
    switch_turn, process_guess, get_player_and_opponent
)
from guess_game.computer_ai import (
    computer_pick_secret, computer_guess_easy, computer_guess_medium,
    computer_guess_hard, get_computer_guess, update_computer_knowledge
)


def make_game(range_min=1, range_max=100, difficulty=Difficulty.MEDIUM,
              status=GameStatus.PLAYING, p1_secret=42, p2_secret=73,
              current_turn="player1", computer_known_low=None, computer_known_high=None):
    return GameState(
        room_key="test123", status=status, is_vs_computer=True, difficulty=difficulty,
        range_min=range_min, range_max=range_max,
        player1=Player(player_id="player1", name="Raghav", secret_number=p1_secret, has_submitted_secret=True),
        player2=Player(player_id="computer_test123", name=f"CPU ({difficulty.value.title()})",
                       secret_number=p2_secret, has_submitted_secret=True, is_computer=True),
        current_turn=current_turn, turn_started_at=None,
        computer_known_low=computer_known_low or range_min,
        computer_known_high=computer_known_high or range_max,
    )


class TestCompareGuess:
    def test_correct(self): assert compare_guess(65, 65) == "correct"
    def test_too_low(self): assert compare_guess(50, 65) == "higher"
    def test_too_high(self): assert compare_guess(80, 65) == "lower"
    def test_off_by_one_low(self): assert compare_guess(64, 65) == "higher"
    def test_off_by_one_high(self): assert compare_guess(66, 65) == "lower"


class TestIsValidNumber:
    def test_within(self): assert is_valid_number(50, make_game()) is True
    def test_at_min(self): assert is_valid_number(1, make_game()) is True
    def test_at_max(self): assert is_valid_number(100, make_game()) is True
    def test_below(self): assert is_valid_number(0, make_game()) is False
    def test_above(self): assert is_valid_number(101, make_game()) is False


class TestSwitchTurn:
    def test_p1_to_p2(self):
        g = make_game(current_turn="player1")
        switch_turn(g)
        assert g.current_turn == "computer_test123"

    def test_p2_to_p1(self):
        g = make_game(current_turn="computer_test123")
        switch_turn(g)
        assert g.current_turn == "player1"

    def test_resets_timer(self):
        g = make_game(); g.turn_started_at = None
        switch_turn(g)
        assert g.turn_started_at is not None


class TestProcessGuess:
    def test_correct_ends_game(self):
        g = make_game(p2_secret=73)
        r = process_guess("player1", "Raghav", 73, g)
        assert r["result"] == "correct" and r["game_over"] is True and g.status == GameStatus.FINISHED

    def test_wrong_switches_turn(self):
        g = make_game(p2_secret=73)
        r = process_guess("player1", "Raghav", 50, g)
        assert r["result"] == "higher" and r["game_over"] is False and g.current_turn == "computer_test123"

    def test_history(self):
        g = make_game(p2_secret=73)
        process_guess("player1", "Raghav", 50, g)
        assert len(g.guesses) == 1 and g.guesses[0].number == 50


class TestComputerAI:
    def test_secret_in_range(self):
        g = make_game()
        for _ in range(50): assert 1 <= computer_pick_secret(g) <= 100

    def test_easy_full_range(self):
        g = make_game(difficulty=Difficulty.EASY, computer_known_low=50, computer_known_high=60)
        for _ in range(50): assert 1 <= computer_guess_easy(g) <= 100

    def test_medium_narrowed(self):
        g = make_game(difficulty=Difficulty.MEDIUM, computer_known_low=40, computer_known_high=60)
        for _ in range(50): assert 40 <= computer_guess_medium(g) <= 60

    def test_hard_midpoint(self):
        g = make_game(difficulty=Difficulty.HARD, computer_known_low=1, computer_known_high=100)
        assert computer_guess_hard(g) == 50

    def test_binary_search_converges(self):
        g = make_game(difficulty=Difficulty.HARD, computer_known_low=1, computer_known_high=100, p1_secret=73)
        for attempt in range(10):
            guess = computer_guess_hard(g)
            result = compare_guess(guess, 73)
            if result == "correct":
                assert attempt < 7; break
            update_computer_knowledge(g, guess, result)
        else:
            pytest.fail("Binary search didn't converge")

    def test_knowledge_higher(self):
        g = make_game(computer_known_low=1, computer_known_high=100)
        update_computer_knowledge(g, 50, "higher")
        assert g.computer_known_low == 51

    def test_knowledge_lower(self):
        g = make_game(computer_known_low=1, computer_known_high=100)
        update_computer_knowledge(g, 75, "lower")
        assert g.computer_known_high == 74

    def test_easy_no_learn(self):
        g = make_game(difficulty=Difficulty.EASY, computer_known_low=1, computer_known_high=100)
        update_computer_knowledge(g, 50, "higher")
        assert g.computer_known_low == 1


# --- Endpoint tests ---

@pytest.fixture
def mock_guess_redis():
    import guess_game.routes as rm
    rm.reset_redis()
    store = {}
    redis_mock = MagicMock()
    async def mock_set(key, value, ex=None): store[key] = value; return True
    async def mock_get(key): return store.get(key)
    redis_mock.set = AsyncMock(side_effect=mock_set)
    redis_mock.get = AsyncMock(side_effect=mock_get)
    rm._redis = redis_mock
    yield redis_mock, store
    rm.reset_redis()

@pytest.fixture
def client(mock_guess_redis):
    from main import app
    with TestClient(app) as c: yield c


class TestStartEndpoint:
    def test_returns_key(self, client):
        r = client.post("/guess-game/start", json={"player_name": "Raghav", "player_id": "p1", "difficulty": "hard"})
        assert r.status_code == 200 and len(r.json()["room_key"]) == 6 and r.json()["computer_name"] == "CPU (Hard)"


class TestSecretEndpoint:
    def test_starts_game(self, client):
        key = client.post("/guess-game/start", json={"player_name": "Raghav", "player_id": "p1", "difficulty": "medium"}).json()["room_key"]
        r = client.post(f"/guess-game/{key}/secret", json={"player_id": "p1", "secret_number": 42})
        assert r.status_code == 200 and r.json()["event"] == "game_started"

    def test_out_of_range(self, client):
        key = client.post("/guess-game/start", json={"player_name": "T", "player_id": "p1", "difficulty": "easy"}).json()["room_key"]
        assert client.post(f"/guess-game/{key}/secret", json={"player_id": "p1", "secret_number": 200}).status_code == 400

    def test_wrong_player(self, client):
        key = client.post("/guess-game/start", json={"player_name": "T", "player_id": "p1", "difficulty": "easy"}).json()["room_key"]
        assert client.post(f"/guess-game/{key}/secret", json={"player_id": "wrong", "secret_number": 50}).status_code == 403


class TestGuessEndpoint:
    def _setup(self, client):
        key = client.post("/guess-game/start", json={"player_name": "R", "player_id": "p1", "difficulty": "easy"}).json()["room_key"]
        client.post(f"/guess-game/{key}/secret", json={"player_id": "p1", "secret_number": 42})
        return key

    def test_round(self, client):
        key = self._setup(client)
        r = client.post(f"/guess-game/{key}/guess", json={"player_id": "p1", "guess_number": 50})
        assert r.status_code == 200 and r.json()["event"] in ("round_complete", "game_over")

    def test_out_of_range(self, client):
        key = self._setup(client)
        assert client.post(f"/guess-game/{key}/guess", json={"player_id": "p1", "guess_number": 999}).status_code == 400

    def test_full_game(self, client):
        key = self._setup(client)
        for guess in range(1, 101):
            r = client.post(f"/guess-game/{key}/guess", json={"player_id": "p1", "guess_number": guess})
            if r.json().get("game_over"): break
        assert r.json()["game_over"] is True


class TestStateEndpoint:
    def test_returns(self, client):
        key = client.post("/guess-game/start", json={"player_name": "T", "player_id": "p1", "difficulty": "easy"}).json()["room_key"]
        assert client.get(f"/guess-game/{key}/state").status_code == 200

    def test_not_found(self, client):
        assert client.get("/guess-game/nonexistent/state").status_code == 404

    def test_secrets_hidden(self, client):
        key = client.post("/guess-game/start", json={"player_name": "T", "player_id": "p1", "difficulty": "easy"}).json()["room_key"]
        client.post(f"/guess-game/{key}/secret", json={"player_id": "p1", "secret_number": 42})
        d = client.get(f"/guess-game/{key}/state").json()
        assert d["player1_secret"] is None and d["player2_secret"] is None
