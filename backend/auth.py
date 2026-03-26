import random
import string
import os
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError

SECRET_KEY = os.getenv("SECRET_KEY", "votelive-secret-key")
ALGORITHM = "HS256"

def generate_room_key(length: int = 6) -> str:
    """
    Generates a random 6-character room key
    e.g. "abc123", "xy9z2k"
    This is the shareable link key — no signup needed
    """
    characters = string.ascii_lowercase + string.digits
    return "".join(random.choices(characters, k=length))


def create_voter_token(voter_id: str, poll_id: int) -> str:
    """
    Creates a lightweight JWT for a voter
    No signup — just encodes voter_id + poll_id
    Expires in 24 hours
    """
    payload = {
        "voter_id": voter_id,
        "poll_id": poll_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_voter_token(token: str) -> dict:
    """
    Verifies the JWT and returns the payload
    Returns None if token is invalid or expired
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def is_poll_expired(expires_at: datetime) -> bool:
    """
    Checks if a poll has passed its expiry time
    """
    now = datetime.now(timezone.utc)
    # If expires_at is naive (no timezone), assume it's UTC
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return now > expires_at
