from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, inspect
from database import Base, engine
from routers import polls, votes, websocket
from guess_game.routes import router as guess_game_router
from guess_game.ws_handler import router as guess_game_ws_router

# create all tables on startup
Base.metadata.create_all(bind=engine)

# auto-migrate: add creator_id column if missing (for existing databases)
try:
    insp = inspect(engine)
    columns = [c['name'] for c in insp.get_columns('polls')]
    if 'creator_id' not in columns:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE polls ADD COLUMN creator_id VARCHAR"))
            conn.commit()
except Exception:
    pass

app = FastAPI(
    title="VoteLive",
    description="Real-time anonymous decision platform for small groups",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(polls.router)
app.include_router(votes.router)
app.include_router(websocket.router)
app.include_router(guess_game_router)
app.include_router(guess_game_ws_router)


@app.get("/")
def root():
    return {
        "app": "VoteLive",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
def health():
    return {"status": "ok"}
