def test_cast_vote_success(client, sample_poll):
    """
    Test that a valid vote is accepted
    """
    room_key = sample_poll["room_key"]
    option_id = sample_poll["options"][0]["id"]

    response = client.post(f"/votes/{room_key}", json={
        "option_id": option_id,
        "voter_id": "voter-abc-123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Vote cast successfully"
    assert data["option_id"] == option_id


def test_duplicate_vote_rejected(client, sample_poll):
    """
    Test that the same voter cannot vote twice in the same poll
    This is the core fairness guarantee
    """
    room_key = sample_poll["room_key"]
    option_id = sample_poll["options"][0]["id"]
    voter_id = "voter-xyz-456"

    # first vote — should succeed
    first = client.post(f"/votes/{room_key}", json={
        "option_id": option_id,
        "voter_id": voter_id
    })
    assert first.status_code == 200

    # second vote — same voter, should be rejected
    second = client.post(f"/votes/{room_key}", json={
        "option_id": option_id,
        "voter_id": voter_id
    })
    assert second.status_code == 400
    assert second.json()["detail"] == "You have already voted"


def test_vote_wrong_option(client, sample_poll):
    """
    Test that voting for an option not in this poll is rejected
    Prevents cross-poll vote injection
    """
    room_key = sample_poll["room_key"]

    response = client.post(f"/votes/{room_key}", json={
        "option_id": 99999,
        "voter_id": "voter-test-789"
    })
    assert response.status_code == 404


def test_vote_nonexistent_poll(client):
    """
    Test that voting on a non-existent poll returns 404
    """
    response = client.post("/votes/xxxxxx", json={
        "option_id": 1,
        "voter_id": "voter-test"
    })
    assert response.status_code == 404


def test_multiple_voters_same_poll(client, sample_poll):
    """
    Test that different voters can all vote in the same poll
    Each voter gets one vote
    """
    room_key = sample_poll["room_key"]
    option_id = sample_poll["options"][0]["id"]

    for i in range(5):
        response = client.post(f"/votes/{room_key}", json={
            "option_id": option_id,
            "voter_id": f"voter-{i}"
        })
        assert response.status_code == 200
