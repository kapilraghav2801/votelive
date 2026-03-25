from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
import os

# reads DATABASE_URL from .env
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./votelive.db")

# engine = the actual connection to the database
# connect_args is only needed for SQLite (threading issue fix)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# sessionmaker = a factory that creates database sessions
# each request gets its own session
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Base = parent class for all your models
# every table you create will inherit from this
Base = declarative_base()

# dependency — FastAPI calls this for every request
# gives a session, then closes it when request is done
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
