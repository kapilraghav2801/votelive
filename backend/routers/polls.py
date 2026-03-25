from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from database import get_db
from models import Poll, Option
from schemas import PollCreate, PollResponse
from auth import generate_room_key

router = APIRouter(prefix="/polls", tags=["polls"])


@router.post("/", response_model=PollResponse)
def create_poll(poll_data: PollCreate, db: Session = Depends(get_db)):
    """
    Creates a new poll with options
    Generates a unique room key automatically
    Sets expiry based on duration_minutes
    """
    # generate unique room key — retry if collision
    while True:
        room_key = generate_room_key()
        existing = db.query(Poll).filter(Poll.room_key == room_key).first()
        if not existing:
            break

    # calculate when poll expires
    expires_at = datetime.utcnow() + timedelta(minutes=poll_data.duration_minutes)

    # create poll
    poll = Poll(
        title=poll_data.title,
        room_key=room_key,
        is_blind=poll_data.is_blind,
        expires_at=expires_at
    )
    db.add(poll)
    db.flush()  # assigns poll.id without committing yet

    # create options linked to this poll
    for opt in poll_data.options:
        option = Option(text=opt.text, poll_id=poll.id)
        db.add(option)

    db.commit()
    db.refresh(poll)
    return poll


@router.get("/{room_key}", response_model=PollResponse)
def get_poll(room_key: str, db: Session = Depends(get_db)):
    """
    Fetches a poll by room key
    This is how people join — they enter the room key
    """
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    return poll


@router.get("/")
def list_polls(db: Session = Depends(get_db)):
    """
    Lists all active polls
    Only returns polls that haven't expired yet
    """
    now = datetime.utcnow()
    polls = db.query(Poll).filter(Poll.expires_at > now).all()
    return polls
