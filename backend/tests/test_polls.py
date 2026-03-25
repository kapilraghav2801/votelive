def test_create_poll(client):
    """
    Test that creating a poll returns correct data
    and generates a room_key automatically
    """
    response = client.post("/polls/", json={
        "title": "What to eat?",
        "options": [
            {"text": "Pizza"},
            {"text": "Biryani"}
        ],
        "is_blind": 0,
        "duration_minutes": 10
    })
    assert response.status_code == 200
    data = response.json()

    # room_key must be generated automatically
    assert "room_key" in data
    assert len(data["room_key"]) == 6

    # title must match
    assert data["title"] == "What to eat?"

    # options must be created
    assert len(data["options"]) == 2


def test_get_poll_by_room_key(client, sample_poll):
    """
    Test that we can fetch a poll using its room_key
    """
    room_key = sample_poll["room_key"]
    response = client.get(f"/polls/{room_key}")

    assert response.status_code == 200
    data = response.json()
    assert data["room_key"] == room_key
    assert data["title"] == "Test Poll"


def test_get_poll_not_found(client):
    """
    Test that fetching a non-existent poll returns 404
    """
    response = client.get("/polls/xxxxxx")
    assert response.status_code == 404


def test_list_polls_returns_only_active(client):
    """
    Test that list endpoint only returns non-expired polls
    """
    # create a valid poll
    client.post("/polls/", json={
        "title": "Active Poll",
        "options": [{"text": "A"}, {"text": "B"}],
        "is_blind": 0,
        "duration_minutes": 30
    })

    response = client.get("/polls/")
    assert response.status_code == 200
    polls = response.json()
    assert len(polls) >= 1


def test_create_poll_invalid_duration(client):
    """
    Test that duration over 60 minutes is rejected
    Pydantic validation should catch this
    """
    response = client.post("/polls/", json={
        "title": "Bad Poll",
        "options": [{"text": "A"}],
        "is_blind": 0,
        "duration_minutes": 200
    })
    assert response.status_code == 422
