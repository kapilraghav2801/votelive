from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Poll
from auth import is_poll_expired
import redis.asyncio as aioredis
import os
import json
import asyncio

router = APIRouter()

# track active connections per poll
# poll_id → list of WebSocket connections
active_connections: dict = {}

def get_redis():
    return aioredis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379"),
        decode_responses=True
    )


@router.websocket("/ws/{room_key}")
async def poll_websocket(room_key: str, websocket: WebSocket):
    """
    WebSocket endpoint for live vote updates
    Each client connects here when they open a poll
    When a new vote comes in, everyone sees it instantly
    """
    # step 1 — verify poll exists
    db = SessionLocal()
    poll = db.query(Poll).filter(Poll.room_key == room_key).first()
    db.close()

    if not poll:
        await websocket.close(code=4004)
        return

    poll_id = poll.id

    # step 2 — accept connection
    await websocket.accept()

    # step 3 — register connection
    if poll_id not in active_connections:
        active_connections[poll_id] = []
    active_connections[poll_id].append(websocket)

    # step 4 — send current leaderboard immediately on connect
    await send_current_results(websocket, poll_id)

    # step 5 — subscribe to Redis pub/sub channel
    # this listens for new votes published by votes.py
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(f"poll:{poll_id}:updates")

    try:
        # listen for messages forever until client disconnects
        async for message in pubsub.listen():
            if message["type"] == "message":
                # broadcast to all connected clients for this poll
                data = message["data"]
                disconnected = []
                for conn in active_connections.get(poll_id, []):
                    try:
                        await conn.send_text(data)
                    except:
                        disconnected.append(conn)

                # clean up disconnected clients
                for conn in disconnected:
                    active_connections[poll_id].remove(conn)

    except WebSocketDisconnect:
        active_connections[poll_id].remove(websocket)
        await pubsub.unsubscribe(f"poll:{poll_id}:updates")
        await r.aclose()


async def send_current_results(websocket: WebSocket, poll_id: int):
    """
    Sends the current leaderboard to a newly connected client
    So they don't see empty results when they first open the poll
    """
    r = get_redis()
    leaderboard = await r.zrevrange(
        f"poll:{poll_id}:votes", 0, -1, withscores=True
    )
    await websocket.send_text(json.dumps({
        "type": "current_results",
        "leaderboard": [
            {"option_id": int(opt), "vote_count": int(score)}
            for opt, score in leaderboard
        ]
    }))
    await r.aclose()
