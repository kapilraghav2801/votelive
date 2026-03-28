from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from typing import List, Optional

# --- Option Schemas ---

class OptionCreate(BaseModel):
    text: str                          # "Pizza"

class OptionResponse(BaseModel):
    id: int
    text: str
    vote_count: int = 0                # computed — not stored in DB
    model_config = ConfigDict(from_attributes=True)  # allows SQLAlchemy model → Pydantic


# --- Poll Schemas ---

class PollCreate(BaseModel):
    title: str                         # "What should we eat?"
    options: List[OptionCreate]        # ["Pizza", "Biryani", "Momos"]
    is_blind: int = 0                  # default = not blind
    duration_minutes: int = Field(default=5, ge=1, le=60)  # 1–60 minutes
    creator_id: Optional[str] = None   # voter_id of the creator

class PollResponse(BaseModel):
    id: int
    title: str
    room_key: str
    is_blind: int
    expires_at: datetime
    created_at: datetime
    creator_id: Optional[str] = None
    options: List[OptionResponse] = []
    model_config = ConfigDict(from_attributes=True)


# --- Vote Schemas ---

class VoteCreate(BaseModel):
    option_id: int                     # which option they picked
    voter_id: str                      # UUID from browser localStorage

class VoteResponse(BaseModel):
    message: str                       # "Vote cast successfully"
    option_id: int


# --- WebSocket message schema ---

class LiveUpdate(BaseModel):
    poll_id: int
    option_id: int
    option_text: str
    vote_count: int                    # new total after this vote
