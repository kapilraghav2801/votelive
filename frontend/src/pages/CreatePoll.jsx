import { useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import Navbar from "../components/Navbar"
import API from "../constants/api"

const inp = {
  width: "100%", padding: "10px 14px",
  background: "#111", border: "1px solid #1e1e1e",
  borderRadius: 8, color: "#e8e8e8",
  fontSize: 13, outline: "none"
}

export default function CreatePoll() {
  const [title, setTitle] = useState("")
  const [options, setOptions] = useState(["", ""])
  const [duration, setDuration] = useState(5)
  const [isBlind, setIsBlind] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const navigate = useNavigate()

  const addOption = () => {
    if (options.length < 6) setOptions([...options, ""])
  }

  const updateOption = (i, val) => {
    const updated = [...options]
    updated[i] = val
    setOptions(updated)
  }

  const removeOption = (i) => {
    if (options.length <= 2) return
    setOptions(options.filter((_, idx) => idx !== i))
  }

  const submit = async () => {
    if (!title.trim()) { setError("Add a question"); return }
    const filled = options.filter(o => o.trim())
    if (filled.length < 2) { setError("Add at least 2 options"); return }

    setLoading(true)
    setError("")
    try {
      const res = await axios.post(`${API}/polls/`, {
        title,
        options: filled.map(text => ({ text })),
        duration_minutes: duration,
        is_blind: isBlind
      })
      navigate(`/vote/${res.data.room_key}`)
    } catch {
      setError("Failed to create poll. Is backend running?")
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{
        maxWidth: 520, margin: "0 auto",
        padding: "40px 24px"
      }}>
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 11, letterSpacing: 3, color: "#444",
          marginBottom: 8, textTransform: "uppercase"
        }}>
          New Poll
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 32 }}>
          Create a poll
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Question */}
          <div>
            <label style={label}>Question</label>
            <input
              placeholder="e.g. What should we eat tonight?"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={inp}
            />
          </div>

          {/* Options */}
          <div>
            <label style={label}>Options</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((opt, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <input
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={e => updateOption(i, e.target.value)}
                    style={{ ...inp }}
                  />
                  {options.length > 2 && (
                    <button onClick={() => removeOption(i)} style={{
                      background: "none", border: "1px solid #222",
                      color: "#555", borderRadius: 8, padding: "0 12px",
                      cursor: "pointer", fontSize: 16
                    }}>×</button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <button onClick={addOption} style={{
                  padding: "9px", background: "transparent",
                  border: "1px dashed #222", borderRadius: 8,
                  color: "#444", cursor: "pointer", fontSize: 13
                }}>
                  + Add option
                </button>
              )}
            </div>
          </div>

          {/* Settings */}
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Duration (minutes)</label>
              <select
                value={duration}
                onChange={e => setDuration(parseInt(e.target.value))}
                style={{ ...inp, color: "#e8e8e8" }}
              >
                {[1, 2, 5, 10, 15, 30, 60].map(d => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Mode</label>
              <select
                value={isBlind}
                onChange={e => setIsBlind(parseInt(e.target.value))}
                style={{ ...inp, color: "#e8e8e8" }}
              >
                <option value={0}>Live results</option>
                <option value={1}>Blind (hide until closed)</option>
              </select>
            </div>
          </div>

          {error && (
            <p style={{ color: "#ff4444", fontSize: 13 }}>{error}</p>
          )}

          <button
            onClick={submit}
            disabled={loading}
            style={{
              padding: 14,
              background: loading ? "#111" : "#e8e8e8",
              color: loading ? "#333" : "#000",
              border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 14,
              cursor: loading ? "default" : "pointer"
            }}
          >
            {loading ? "Creating..." : "Create Poll"}
          </button>
        </div>
      </div>
    </div>
  )
}

const label = {
  display: "block", fontSize: 11,
  fontFamily: "'Space Mono', monospace",
  letterSpacing: 1, color: "#555",
  marginBottom: 8, textTransform: "uppercase"
}
