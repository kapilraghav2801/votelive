from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine
from routers import polls, votes, websocket

# create all tables on startup
Base.metadata.create_all(bind=engine)

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
