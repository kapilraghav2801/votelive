from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Vote, Option, Poll
from schemas import VoteCreate, VoteResponse
from auth import is_poll_expired, create_voter_token
import redis.asyncio as aioredis
import os
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/votes", tags=["votes"])

# Redis connection — lazy init
_redis = None

def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True
        )
    return _redis

def reset_redis():
    global _redis
    _redis = None


@router.post("/{room_key}", response_model=VoteResponse)
async def cast_vote(
    room_key: str,
    vote_data: VoteCreate,
    db: Session = Depends(get_db)
):
    # step 1 — find the poll
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    # step 2 — check poll is still open
    if is_poll_expired(poll.expires_at):
        raise HTTPException(status_code=400, detail="Poll has expired")

    # step 3 — check option belongs to this poll
    option = db.query(Option).filter(
        Option.id == vote_data.option_id,
        Option.poll_id == poll.id
    ).first()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    # step 4 — check if voter already voted (database constraint)
    existing_vote = db.query(Vote).filter(
        Vote.poll_id == poll.id,
        Vote.voter_id == vote_data.voter_id
    ).first()
    if existing_vote:
        raise HTTPException(status_code=400, detail="You have already voted")

    # step 5 — save vote to database
    vote = Vote(
        option_id=vote_data.option_id,
        poll_id=poll.id,
        voter_id=vote_data.voter_id
    )
    db.add(vote)
    db.commit()

    # step 6 — update Redis leaderboard
    # ZINCRBY increments the score of option_id in the sorted set
    r = get_redis()
    await r.zincrby(f"poll:{poll.id}:votes", 1, str(vote_data.option_id))

    # step 7 — publish live update for WebSocket fans
    update = {
        "poll_id": poll.id,
        "option_id": vote_data.option_id,
        "option_text": option.text,
        "vote_count": int(await r.zscore(
            f"poll:{poll.id}:votes",
            str(vote_data.option_id)
        ) or 0)
    }
    await r.publish(f"poll:{poll.id}:updates", json.dumps(update))

    return VoteResponse(
        message="Vote cast successfully",
        option_id=vote_data.option_id
    )


@router.get("/{room_key}/results")
async def get_results(room_key: str, db: Session = Depends(get_db)):
    """
    Returns current vote counts — tries Redis first, falls back to database
    """
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    results = []
    try:
        r = get_redis()
        leaderboard = await r.zrevrange(
            f"poll:{poll.id}:votes", 0, -1, withscores=True
        )
        for option_id, score in leaderboard:
            option = db.query(Option).filter(Option.id == int(option_id)).first()
            if option:
                results.append({
                    "option_id": int(option_id),
                    "option_text": option.text,
                    "vote_count": int(score)
                })
    except Exception:
        logger.warning("Redis unavailable, falling back to database counts")
        # fallback: count votes from database
        counts = (
            db.query(Vote.option_id, func.count(Vote.id))
            .filter(Vote.poll_id == poll.id)
            .group_by(Vote.option_id)
            .all()
        )
        for option_id, count in counts:
            option = db.query(Option).filter(Option.id == option_id).first()
            if option:
                results.append({
                    "option_id": option_id,
                    "option_text": option.text,
                    "vote_count": count
                })

    return {
        "poll_id": poll.id,
        "title": poll.title,
        "is_expired": is_poll_expired(poll.expires_at),
        "results": results
    }
