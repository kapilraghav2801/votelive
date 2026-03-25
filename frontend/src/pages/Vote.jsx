import { useEffect, useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import axios from "axios"
import Navbar from "../components/Navbar"
import API from "../constants/api"

const VOTER_ID_KEY = "votelive_voter_id"

function getVoterId() {
  let id = localStorage.getItem(VOTER_ID_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(VOTER_ID_KEY, id)
  }
  return id
}

export default function Vote() {
  const { roomKey } = useParams()
  const navigate = useNavigate()
  const [poll, setPoll] = useState(null)
  const [results, setResults] = useState([])
  const [voted, setVoted] = useState(false)
  const [selectedOption, setSelectedOption] = useState(null)
  const [error, setError] = useState("")
  const [expired, setExpired] = useState(false)
  const [timeLeft, setTimeLeft] = useState("")
  const wsRef = useRef(null)

  useEffect(() => {
    axios.get(`${API}/polls/${roomKey}`)
      .then(r => {
        setPoll(r.data)
        checkExpiry(r.data.expires_at)
      })
      .catch(() => setError("Poll not found"))

    axios.get(`${API}/votes/${roomKey}/results`)
      .then(r => setResults(r.data.results || []))
      .catch(() => {})

    // WebSocket for live updates
    const ws = new WebSocket(`${API.replace("http", "ws")}/ws/${roomKey}`)
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === "current_results") {
        setResults(data.leaderboard.map(item => ({
          option_id: item.option_id,
          vote_count: item.vote_count
        })))
      } else if (data.option_id) {
        setResults(prev => {
          const updated = [...prev]
          const idx = updated.findIndex(r => r.option_id === data.option_id)
          if (idx >= 0) updated[idx] = { ...updated[idx], vote_count: data.vote_count }
          else updated.push({ option_id: data.option_id, vote_count: data.vote_count })
          return updated
        })
      }
    }
    wsRef.current = ws
    return () => ws.close()
  }, [roomKey])

  const checkExpiry = (expiresAt) => {
    const update = () => {
      const diff = new Date(expiresAt) - new Date()
      if (diff <= 0) { setExpired(true); setTimeLeft("Closed"); return }
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${m}:${s.toString().padStart(2, "0")}`)
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }

  const castVote = async (optionId) => {
    if (voted || expired) return
    try {
      await axios.post(`${API}/votes/${roomKey}`, {
        option_id: optionId,
        voter_id: getVoterId()
      })
      setVoted(true)
      setSelectedOption(optionId)
      // refresh results
      const r = await axios.get(`${API}/votes/${roomKey}/results`)
      setResults(r.data.results || [])
    } catch (e) {
      if (e.response?.data?.detail === "You have already voted") {
        setVoted(true)
        setError("You already voted in this poll")
      } else {
        setError("Vote failed. Try again.")
      }
    }
  }

  const maxVotes = Math.max(...results.map(r => r.vote_count || 0), 1)
  const totalVotes = results.reduce((sum, r) => sum + (r.vote_count || 0), 0)

  if (error && !poll) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{ textAlign: "center", padding: "80px 24px" }}>
        <p style={{ color: "#555", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {error}
        </p>
        <button onClick={() => navigate("/")} style={{
          marginTop: 20, padding: "10px 24px",
          background: "#e8e8e8", color: "#000",
          border: "none", borderRadius: 8,
          fontWeight: 700, cursor: "pointer"
        }}>Go Home</button>
      </div>
    </div>
  )

  if (!poll) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{ textAlign: "center", padding: "80px 24px", color: "#444" }}>
        Loading...
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 24px" }}>

        {/* Room key + timer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11, letterSpacing: 3, color: "#444"
          }}>
            ROOM · {roomKey.toUpperCase()}
          </div>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 12, color: expired ? "#ff4444" : "#888",
            padding: "4px 12px", border: "1px solid #1a1a1a",
            borderRadius: 20
          }}>
            {expired ? "CLOSED" : `⏱ ${timeLeft}`}
          </div>
        </div>

        {/* Question */}
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          {poll.title}
        </h2>
        <p style={{ fontSize: 13, color: "#444", marginBottom: 32 }}>
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""} ·
          {poll.is_blind && !expired ? " results hidden until closed" : " live results"}
        </p>

        {/* Options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {poll.options.map(opt => {
            const result = results.find(r => r.option_id === opt.id)
            const count = result?.vote_count || 0
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
            const isWinning = count === maxVotes && count > 0
            const isSelected = selectedOption === opt.id
            const showResults = !poll.is_blind || expired

            return (
              <div
                key={opt.id}
                onClick={() => castVote(opt.id)}
                style={{
                  position: "relative", padding: "14px 16px",
                  borderRadius: 10, cursor: voted || expired ? "default" : "pointer",
                  border: isSelected
                    ? "1px solid #e8e8e8"
                    : isWinning && showResults
                      ? "1px solid #555"
                      : "1px solid #1a1a1a",
                  background: "#0d0d0d",
                  overflow: "hidden",
                  transition: "border 0.2s"
                }}
              >
                {/* Progress bar background */}
                {showResults && count > 0 && (
                  <div style={{
                    position: "absolute", inset: 0,
                    width: `${pct}%`,
                    background: isWinning ? "rgba(232,232,232,0.06)" : "rgba(255,255,255,0.03)",
                    transition: "width 0.4s ease"
                  }} />
                )}

                <div style={{
                  position: "relative", display: "flex",
                  justifyContent: "space-between", alignItems: "center"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isSelected && (
                      <span style={{ color: "#e8e8e8", fontSize: 13 }}>✓</span>
                    )}
                    <span style={{
                      fontSize: 14, fontWeight: isWinning && showResults ? 600 : 400,
                      color: isSelected ? "#e8e8e8" : "#aaa"
                    }}>
                      {opt.text}
                    </span>
                  </div>
                  {showResults && (
                    <span style={{
                      fontSize: 12, color: "#555",
                      fontFamily: "'Space Mono', monospace"
                    }}>
                      {count} · {pct}%
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Status messages */}
        {voted && (
          <p style={{ marginTop: 20, fontSize: 13, color: "#555", textAlign: "center" }}>
            Vote recorded · results update live
          </p>
        )}
        {error && voted && (
          <p style={{ marginTop: 8, fontSize: 12, color: "#888", textAlign: "center" }}>
            {error}
          </p>
        )}
        {expired && (
          <p style={{ marginTop: 20, fontSize: 13, color: "#ff4444", textAlign: "center", fontFamily: "'Space Mono', monospace" }}>
            This poll is closed
          </p>
        )}

        {/* Share */}
        <div style={{
          marginTop: 40, padding: "16px 20px",
          border: "1px solid #1a1a1a", borderRadius: 10,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <div>
            <div style={{ fontSize: 11, color: "#444", fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
              SHARE ROOM KEY
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 4, fontFamily: "'Space Mono', monospace", marginTop: 4 }}>
              {roomKey.toUpperCase()}
            </div>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(roomKey)}
            style={{
              padding: "8px 16px", background: "transparent",
              border: "1px solid #222", borderRadius: 8,
              color: "#888", cursor: "pointer", fontSize: 12
            }}
          >
            Copy
          </button>
        </div>

      </div>
    </div>
  )
}
