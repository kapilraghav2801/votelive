import { useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import Navbar from "../components/Navbar"
import API from "../constants/api"
import { getVoterId, getVoterName, setVoterName } from "../utils/voter"

const inp = {
  width: "100%", padding: "10px 14px",
  background: "#111", border: "1px solid #1e1e1e",
  borderRadius: 8, color: "#e8e8e8",
  fontSize: 13, outline: "none"
}

const label = {
  display: "block", fontSize: 11,
  fontFamily: "'Space Mono', monospace",
  letterSpacing: 1, color: "#555",
  marginBottom: 8, textTransform: "uppercase"
}

const ranges = [
  { label: "1 – 100", min: 1, max: 100 },
  { label: "1 – 500", min: 1, max: 500 },
  { label: "1 – 1000", min: 1, max: 1000 },
]

const difficulties = [
  { value: "easy", label: "Easy", desc: "Random guesses — beatable" },
  { value: "medium", label: "Medium", desc: "Smart random — challenging" },
  { value: "hard", label: "Hard", desc: "Binary search — nearly unbeatable" },
]

export default function GuessGameSetup() {
  const [mode, setMode] = useState("computer") // "computer" or "friend"
  const [name, setName] = useState(getVoterName() || "")
  const [selectedRange, setSelectedRange] = useState(0)
  const [difficulty, setDifficulty] = useState("medium")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const navigate = useNavigate()

  // Join room state
  const [joinKey, setJoinKey] = useState("")

  // --- VS COMPUTER ---
  const handleStartComputer = async () => {
    if (!name.trim()) { setError("Enter your name"); return }
    setLoading(true)
    setError("")
    setVoterName(name.trim())

    try {
      const r = ranges[selectedRange]
      const res = await axios.post(`${API}/guess-game/start`, {
        player_name: name.trim(),
        player_id: getVoterId(),
        range_min: r.min,
        range_max: r.max,
        difficulty
      })
      sessionStorage.setItem(`game_range_${res.data.room_key}`, JSON.stringify({ min: r.min, max: r.max }))
      sessionStorage.setItem(`game_mode_${res.data.room_key}`, "computer")
      navigate(`/guess-game/${res.data.room_key}`)
    } catch {
      setError("Failed to create game. Is backend running?")
      setLoading(false)
    }
  }

  // --- VS FRIEND: CREATE ROOM ---
  const handleCreateRoom = async () => {
    if (!name.trim()) { setError("Enter your name"); return }
    setLoading(true)
    setError("")
    setVoterName(name.trim())

    try {
      const r = ranges[selectedRange]
      const res = await axios.post(`${API}/guess-game/create-room`, {
        player_name: name.trim(),
        player_id: getVoterId(),
        range_min: r.min,
        range_max: r.max,
      })
      sessionStorage.setItem(`game_range_${res.data.room_key}`, JSON.stringify({ min: r.min, max: r.max }))
      sessionStorage.setItem(`game_mode_${res.data.room_key}`, "multiplayer")
      navigate(`/guess-game/${res.data.room_key}`)
    } catch {
      setError("Failed to create room. Is backend running?")
      setLoading(false)
    }
  }

  // --- VS FRIEND: JOIN ROOM ---
  const handleJoinRoom = async () => {
    if (!name.trim()) { setError("Enter your name"); return }
    if (!joinKey.trim()) { setError("Enter room key"); return }
    setLoading(true)
    setError("")
    setVoterName(name.trim())

    const key = joinKey.trim().toLowerCase()
    try {
      const res = await axios.get(`${API}/guess-game/${key}/validate`)
      if (!res.data.can_join) {
        setError("Room is not accepting players")
        setLoading(false)
        return
      }
      sessionStorage.setItem(`game_range_${key}`, JSON.stringify({
        min: res.data.range_min, max: res.data.range_max
      }))
      sessionStorage.setItem(`game_mode_${key}`, "multiplayer")
      sessionStorage.setItem(`game_join_${key}`, JSON.stringify({
        player_id: getVoterId(),
        player_name: name.trim()
      }))
      navigate(`/guess-game/${key}`)
    } catch (e) {
      setError(e.response?.data?.detail || "Room not found")
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 24px" }}>

        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 11, letterSpacing: 3, color: "#444",
          marginBottom: 8, textTransform: "uppercase"
        }}>
          Guessing Game
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          {mode === "computer" ? "Play vs Computer" : "Play vs Friend"}
        </h2>
        <p style={{ fontSize: 13, color: "#555", marginBottom: 28, lineHeight: 1.6 }}>
          Pick a secret number. Take turns guessing. Only hint: higher or lower.
        </p>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, borderRadius: 8, overflow: "hidden", border: "1px solid #1e1e1e" }}>
          {[
            { key: "computer", label: "vs Computer" },
            { key: "friend", label: "vs Friend" }
          ].map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setError("") }}
              style={{
                flex: 1, padding: "10px 0",
                background: mode === m.key ? "#e8e8e8" : "#111",
                color: mode === m.key ? "#000" : "#888",
                border: "none", cursor: "pointer",
                fontWeight: mode === m.key ? 700 : 400,
                fontSize: 13, fontFamily: "'Space Mono', monospace"
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Name — always shown */}
          <div>
            <label style={label}>Your name</label>
            <input
              placeholder="e.g. Raghav"
              value={name}
              onChange={e => { setName(e.target.value); setError("") }}
              style={inp}
            />
          </div>

          {/* ===== VS COMPUTER MODE ===== */}
          {mode === "computer" && (
            <>
              {/* Range */}
              <div>
                <label style={label}>Number range</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {ranges.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedRange(i)}
                      style={{
                        flex: 1, padding: "10px 0",
                        background: selectedRange === i ? "#e8e8e8" : "#111",
                        color: selectedRange === i ? "#000" : "#888",
                        border: selectedRange === i ? "1px solid #e8e8e8" : "1px solid #1e1e1e",
                        borderRadius: 8, cursor: "pointer",
                        fontWeight: selectedRange === i ? 700 : 400,
                        fontSize: 13, fontFamily: "'Space Mono', monospace"
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div>
                <label style={label}>Difficulty</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {difficulties.map(d => (
                    <button
                      key={d.value}
                      onClick={() => setDifficulty(d.value)}
                      style={{
                        padding: "12px 16px",
                        background: difficulty === d.value ? "#0d0d0d" : "#0a0a0a",
                        border: difficulty === d.value ? "1px solid #e8e8e8" : "1px solid #1e1e1e",
                        borderRadius: 10, cursor: "pointer",
                        textAlign: "left", display: "flex",
                        justifyContent: "space-between", alignItems: "center"
                      }}
                    >
                      <div>
                        <div style={{
                          fontSize: 14,
                          fontWeight: difficulty === d.value ? 700 : 400,
                          color: difficulty === d.value ? "#e8e8e8" : "#888"
                        }}>{d.label}</div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{d.desc}</div>
                      </div>
                      {difficulty === d.value && <span style={{ color: "#e8e8e8", fontSize: 14 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleStartComputer}
                disabled={loading}
                style={btnStyle(loading)}
              >
                {loading ? "Creating..." : "Start Game"}
              </button>
            </>
          )}

          {/* ===== VS FRIEND MODE ===== */}
          {mode === "friend" && (
            <>
              {/* Create Room */}
              <div style={{
                background: "#0d0d0d", border: "1px solid #1a1a1a",
                borderRadius: 12, padding: 20
              }}>
                <div style={{
                  fontSize: 11, fontFamily: "'Space Mono', monospace",
                  letterSpacing: 2, color: "#444", marginBottom: 14, textTransform: "uppercase"
                }}>
                  Create a room
                </div>

                {/* Range */}
                <div style={{ marginBottom: 14 }}>
                  <label style={label}>Number range</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {ranges.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedRange(i)}
                        style={{
                          flex: 1, padding: "8px 0",
                          background: selectedRange === i ? "#e8e8e8" : "#111",
                          color: selectedRange === i ? "#000" : "#888",
                          border: selectedRange === i ? "1px solid #e8e8e8" : "1px solid #1e1e1e",
                          borderRadius: 8, cursor: "pointer",
                          fontWeight: selectedRange === i ? 700 : 400,
                          fontSize: 12, fontFamily: "'Space Mono', monospace"
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleCreateRoom}
                  disabled={loading}
                  style={btnStyle(loading)}
                >
                  {loading ? "Creating..." : "Create Room & Share Key"}
                </button>
              </div>

              {/* Divider */}
              <div style={{ textAlign: "center", color: "#333", fontSize: 12 }}>or</div>

              {/* Join Room */}
              <div style={{
                background: "#0d0d0d", border: "1px solid #1a1a1a",
                borderRadius: 12, padding: 20
              }}>
                <div style={{
                  fontSize: 11, fontFamily: "'Space Mono', monospace",
                  letterSpacing: 2, color: "#444", marginBottom: 14, textTransform: "uppercase"
                }}>
                  Join a room
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    placeholder="Enter room key"
                    value={joinKey}
                    onChange={e => { setJoinKey(e.target.value); setError("") }}
                    onKeyDown={e => e.key === "Enter" && handleJoinRoom()}
                    style={{
                      ...inp, flex: 1,
                      letterSpacing: 2, fontFamily: "'Space Mono', monospace"
                    }}
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={loading}
                    style={{
                      padding: "10px 20px", background: "#e8e8e8",
                      color: "#000", border: "none", borderRadius: 8,
                      fontWeight: 700, fontSize: 13, cursor: "pointer",
                      opacity: loading ? 0.5 : 1
                    }}
                  >
                    Join
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p style={{ color: "#ff4444", fontSize: 13 }}>{error}</p>}
        </div>

        <p style={{ color: "#333", fontSize: 13, textAlign: "center", marginTop: 32 }}>
          <span
            onClick={() => navigate("/")}
            style={{ color: "#888", cursor: "pointer", textDecoration: "underline" }}
          >
            ← back to VoteLive
          </span>
        </p>
      </div>
    </div>
  )
}

const btnStyle = (loading) => ({
  width: "100%", padding: 14,
  background: loading ? "#111" : "#e8e8e8",
  color: loading ? "#333" : "#000",
  border: "none", borderRadius: 8,
  fontWeight: 700, fontSize: 14,
  cursor: loading ? "default" : "pointer"
})
