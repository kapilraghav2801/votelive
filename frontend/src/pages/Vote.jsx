import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Navbar from '../components/Navbar';
import API from '../constants/api';
import { getVoterId } from '../utils/voter';

export default function Vote() {
  const { roomKey } = useParams();
  const navigate = useNavigate();
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState([]);
  const [voted, setVoted] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  const [ending, setEnding] = useState(false);
  const wsRef = useRef(null);
  const timerRef = useRef(null);

  const isCreator = poll?.creator_id && poll.creator_id === getVoterId();

  // Fetch poll + results, connect WebSocket
  useEffect(() => {
    let cancelled = false;

    axios
      .get(`${API}/polls/${roomKey}`)
      .then((r) => {
        if (cancelled) return;
        setPoll(r.data);
      })
      .catch(() => {
        if (!cancelled) setError('Poll not found');
      });

    axios
      .get(`${API}/votes/${roomKey}/results`)
      .then((r) => {
        if (!cancelled) setResults(r.data.results || []);
      })
      .catch(() => {});

    // WebSocket for live updates
    const connectWs = () => {
      try {
        const ws = new WebSocket(`${API.replace('http', 'ws')}/ws/${roomKey}`);
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'current_results') {
              setResults(
                data.leaderboard.map((item) => ({
                  option_id: item.option_id,
                  vote_count: item.vote_count,
                })),
              );
            } else if (data.option_id) {
              setResults((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex(
                  (r) => r.option_id === data.option_id,
                );
                if (idx >= 0)
                  updated[idx] = {
                    ...updated[idx],
                    vote_count: data.vote_count,
                  };
                else
                  updated.push({
                    option_id: data.option_id,
                    vote_count: data.vote_count,
                  });
                return updated;
              });
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          // Reconnect after 3 seconds if not intentionally closed
          if (!cancelled) {
            setTimeout(() => {
              if (!cancelled) {
                wsRef.current = connectWs();
              }
            }, 3000);
          }
        };
        wsRef.current = ws;
        return ws;
      } catch {
        return null;
      }
    };

    connectWs();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
    };
  }, [roomKey]);

  // Timer — separate effect so cleanup works properly
  useEffect(() => {
    if (!poll?.expires_at) return;

    const expiresAt = poll.expires_at;
    const update = () => {
      const utcExpiry =
        expiresAt.endsWith('Z') || expiresAt.includes('+')
          ? expiresAt
          : expiresAt + 'Z';
      const diff = new Date(utcExpiry) - new Date();
      if (diff <= 0) {
        setExpired(true);
        setTimeLeft('Closed');
        clearInterval(timerRef.current);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => clearInterval(timerRef.current);
  }, [poll?.expires_at]);

  const castVote = async (optionId) => {
    if (voted || expired) return;
    try {
      await axios.post(`${API}/votes/${roomKey}`, {
        option_id: optionId,
        voter_id: getVoterId(),
      });
      setVoted(true);
      setSelectedOption(optionId);
      const r = await axios.get(`${API}/votes/${roomKey}/results`);
      setResults(r.data.results || []);
    } catch (e) {
      if (e.response?.data?.detail === 'You have already voted') {
        setVoted(true);
        setError('You already voted in this poll');
      } else {
        setError('Vote failed. Try again.');
      }
    }
  };

  const endPoll = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await axios.patch(`${API}/polls/${roomKey}/end`, {
        creator_id: getVoterId(),
      });
      setExpired(true);
      setTimeLeft('Closed');
      // Refresh poll data to get updated expires_at
      const r = await axios.get(`${API}/polls/${roomKey}`);
      setPoll(r.data);
    } catch {
      setError('Failed to end poll');
    }
    setEnding(false);
  };

  const maxVotes = Math.max(...results.map((r) => r.vote_count || 0), 1);
  const totalVotes = results.reduce((sum, r) => sum + (r.vote_count || 0), 0);

  if (error && !poll)
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
        <Navbar />
        <div style={{ textAlign: 'center', padding: '80px 24px' }}>
          <p
            style={{
              color: '#555',
              fontFamily: "'Space Mono', monospace",
              fontSize: 13,
            }}
          >
            {error}
          </p>
          <button
            onClick={() => navigate('/')}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              background: '#e8e8e8',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Go Home
          </button>
        </div>
      </div>
    );

  if (!poll)
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
        <Navbar />
        <div
          style={{ textAlign: 'center', padding: '80px 24px', color: '#444' }}
        >
          Loading...
        </div>
      </div>
    );

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <Navbar />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px' }}>
        {/* Room key + timer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 28,
          }}
        >
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              letterSpacing: 3,
              color: '#444',
            }}
          >
            ROOM · {roomKey.toUpperCase()}
          </div>
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              color: expired ? '#ff4444' : '#888',
              padding: '4px 12px',
              border: '1px solid #1a1a1a',
              borderRadius: 20,
            }}
          >
            {expired ? 'CLOSED' : `⏱ ${timeLeft}`}
          </div>
        </div>

        {/* Question */}
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          {poll.title}
        </h2>
        <p style={{ fontSize: 13, color: '#444', marginBottom: 32 }}>
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''} ·
          {poll.is_blind && !expired
            ? ' results hidden until closed'
            : ' live results'}
        </p>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {poll.options.map((opt) => {
            const result = results.find((r) => r.option_id === opt.id);
            const count = result?.vote_count || 0;
            const pct =
              totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isWinning = count === maxVotes && count > 0;
            const isSelected = selectedOption === opt.id;
            const showResults = !poll.is_blind || expired;

            return (
              <div
                key={opt.id}
                onClick={() => castVote(opt.id)}
                style={{
                  position: 'relative',
                  padding: '14px 16px',
                  borderRadius: 10,
                  cursor: voted || expired ? 'default' : 'pointer',
                  border: isSelected
                    ? '1px solid #e8e8e8'
                    : isWinning && showResults
                      ? '1px solid #555'
                      : '1px solid #1a1a1a',
                  background: '#0d0d0d',
                  overflow: 'hidden',
                  transition: 'border 0.2s',
                }}
              >
                {showResults && count > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${pct}%`,
                      background: isWinning
                        ? 'rgba(232,232,232,0.06)'
                        : 'rgba(255,255,255,0.03)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                )}
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    {isSelected && (
                      <span style={{ color: '#e8e8e8', fontSize: 13 }}>✓</span>
                    )}
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: isWinning && showResults ? 600 : 400,
                        color: isSelected ? '#e8e8e8' : '#aaa',
                      }}
                    >
                      {opt.text}
                    </span>
                  </div>
                  {showResults && (
                    <span
                      style={{
                        fontSize: 12,
                        color: '#555',
                        fontFamily: "'Space Mono', monospace",
                      }}
                    >
                      {count} · {pct}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Status messages */}
        {voted && (
          <p
            style={{
              marginTop: 20,
              fontSize: 13,
              color: '#555',
              textAlign: 'center',
            }}
          >
            Vote recorded · results update live
          </p>
        )}
        {error && voted && (
          <p
            style={{
              marginTop: 8,
              fontSize: 12,
              color: '#888',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}
        {expired && (
          <p
            style={{
              marginTop: 20,
              fontSize: 13,
              color: '#ff4444',
              textAlign: 'center',
              fontFamily: "'Space Mono', monospace",
            }}
          >
            This poll is closed
          </p>
        )}

        {/* End Poll button — only visible to creator when poll is active */}
        {isCreator && !expired && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              onClick={endPoll}
              disabled={ending}
              style={{
                padding: '10px 24px',
                background: 'transparent',
                border: '1px solid #ff4444',
                borderRadius: 8,
                color: '#ff4444',
                fontWeight: 700,
                fontSize: 13,
                cursor: ending ? 'default' : 'pointer',
                opacity: ending ? 0.5 : 1,
              }}
            >
              {ending ? 'Ending...' : 'End Poll Early'}
            </button>
          </div>
        )}

        {/* Results summary when expired */}
        {expired && totalVotes > 0 && (
          <div
            style={{
              marginTop: 32,
              padding: '20px',
              border: '1px solid #1a1a1a',
              borderRadius: 10,
              background: '#0d0d0d',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#444',
                fontFamily: "'Space Mono', monospace",
                letterSpacing: 1,
                marginBottom: 12,
              }}
            >
              FINAL RESULTS
            </div>
            {[...results]
              .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
              .map((r, i) => {
                const opt = poll.options.find((o) => o.id === r.option_id);
                const pct =
                  totalVotes > 0
                    ? Math.round((r.vote_count / totalVotes) * 100)
                    : 0;
                return (
                  <div
                    key={r.option_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderBottom:
                        i < results.length - 1 ? '1px solid #1a1a1a' : 'none',
                    }}
                  >
                    <span
                      style={{
                        color: i === 0 ? '#e8e8e8' : '#888',
                        fontSize: 14,
                        fontWeight: i === 0 ? 700 : 400,
                      }}
                    >
                      {i === 0 ? '🏆 ' : ''}
                      {opt?.text || `Option ${r.option_id}`}
                    </span>
                    <span
                      style={{
                        color: '#555',
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 13,
                      }}
                    >
                      {r.vote_count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: '#444',
                textAlign: 'center',
              }}
            >
              Total: {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Share */}
        <div
          style={{
            marginTop: 40,
            padding: '16px 20px',
            border: '1px solid #1a1a1a',
            borderRadius: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: '#444',
                fontFamily: "'Space Mono', monospace",
                letterSpacing: 1,
              }}
            >
              SHARE ROOM KEY
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 4,
                fontFamily: "'Space Mono', monospace",
                marginTop: 4,
              }}
            >
              {roomKey.toUpperCase()}
            </div>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(roomKey)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid #222',
              borderRadius: 8,
              color: '#888',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
