from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base

class Poll(Base):
    __tablename__ = "polls"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)        # "What should we eat?"
    room_key = Column(String, unique=True, index=True)  # "abc123" — join link
    is_blind = Column(Integer, default=0)         # 1 = hide results until closed
    expires_at = Column(DateTime, nullable=False) # when poll auto-closes
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # one poll has many options
    # if poll deleted → delete all its options too
    options = relationship("Option", back_populates="poll", cascade="all, delete-orphan")


class Option(Base):
    __tablename__ = "options"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(String, nullable=False)         # "Pizza"
    poll_id = Column(Integer, ForeignKey("polls.id"), nullable=False)  # which poll

    # one option has many votes
    votes = relationship("Vote", back_populates="option", cascade="all, delete-orphan")

    # link back to poll
    poll = relationship("Poll", back_populates="options")


class Vote(Base):
    __tablename__ = "votes"

    id = Column(Integer, primary_key=True, index=True)
    option_id = Column(Integer, ForeignKey("options.id"), nullable=False)
    poll_id = Column(Integer, ForeignKey("polls.id"), nullable=False)
    voter_id = Column(String, nullable=False)     # UUID from browser localStorage
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # one person can only vote once per poll
    # database enforces this at the constraint level
    __table_args__ = (
        UniqueConstraint("poll_id", "voter_id", name="one_vote_per_person"),
    )

    option = relationship("Option", back_populates="votes")