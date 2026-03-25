import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import AsyncMock, MagicMock
from database import Base, get_db
from main import app
import routers.votes as votes_module

TEST_DATABASE_URL = "sqlite:///./test_votelive.db"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def mock_redis():
    """
    Replaces the real Redis with a fake one for tests
    This is called 'mocking' — we simulate Redis behavior
    without needing a real Redis server running
    """
    # reset cached connection first
    votes_module.reset_redis()

    # create fake Redis object
    redis_mock = MagicMock()
    redis_mock.zincrby = AsyncMock(return_value=1)
    redis_mock.zscore = AsyncMock(return_value=1)
    redis_mock.publish = AsyncMock(return_value=1)
    redis_mock.zrevrange = AsyncMock(return_value=[])

    # inject fake Redis into votes module
    votes_module._redis = redis_mock

    yield redis_mock

    # cleanup after test
    votes_module.reset_redis()


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def sample_poll(client):
    response = client.post("/polls/", json={
        "title": "Test Poll",
        "options": [
            {"text": "Option A"},
            {"text": "Option B"},
            {"text": "Option C"}
        ],
        "is_blind": 0,
        "duration_minutes": 30
    })
    return response.json()
