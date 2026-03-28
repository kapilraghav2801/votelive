import { useState } from "react"
import { useNavigate } from "react-router-dom"
import Navbar from "../components/Navbar"
import { getVoterName, setVoterName } from "../utils/voter"

export default function Home() {
  const [name, setName] = useState(getVoterName())
  const [roomKey, setRoomKey] = useState("")
  const [error, setError] = useState("")
  const navigate = useNavigate()

  const join = () => {
    if (!name.trim()) { setError("Enter your name first"); return }
    if (!roomKey.trim()) { setError("Enter a room key"); return }
    setVoterName(name.trim())
    navigate(`/vote/${roomKey.trim().toLowerCase()}`)
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minHeight: "calc(100vh - 61px)", padding: 24
      }}>
        <div style={{ textAlign: "center", maxWidth: 480, width: "100%" }}>
          <div style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 11, letterSpacing: 3, color: "#444",
            marginBottom: 20, textTransform: "uppercase"
          }}>
            Real-time anonymous decisions
          </div>
          <h1 style={{
            fontSize: 40, fontWeight: 700, lineHeight: 1.15,
            marginBottom: 12, color: "#e8e8e8"
          }}>
            Make group decisions<br />in seconds
          </h1>
          <p style={{ fontSize: 15, color: "#555", marginBottom: 48, lineHeight: 1.6 }}>
            No signup. Share a 6-character room key.<br />
            Everyone votes live. Results update instantly.
          </p>

          <div style={{
            background: "#0d0d0d", border: "1px solid #1a1a1a",
            borderRadius: 12, padding: 28, marginBottom: 16
          }}>
            <div style={{
              fontSize: 11, fontFamily: "'Space Mono', monospace",
              letterSpacing: 2, color: "#444", marginBottom: 14,
              textTransform: "uppercase"
            }}>
              Join a poll
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                placeholder="Your name"
                value={name}
                onChange={e => { setName(e.target.value); setError("") }}
                style={{
                  padding: "11px 14px", background: "#111", border: "1px solid #222",
                  borderRadius: 8, color: "#e8e8e8", fontSize: 14, outline: "none"
                }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  placeholder="Enter room key (e.g. abc123)"
                  value={roomKey}
                  onChange={e => { setRoomKey(e.target.value); setError("") }}
                  onKeyDown={e => e.key === "Enter" && join()}
                  style={{
                    flex: 1, padding: "11px 14px", background: "#111", border: "1px solid #222",
                    borderRadius: 8, color: "#e8e8e8", fontSize: 14, outline: "none",
                    letterSpacing: 2, fontFamily: "'Space Mono', monospace"
                  }}
                />
                <button onClick={join} style={{
                  padding: "11px 20px", background: "#e8e8e8", color: "#000",
                  border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer"
                }}>Join</button>
              </div>
            </div>
            {error && <p style={{ color: "#ff4444", fontSize: 12, marginTop: 8 }}>{error}</p>}
          </div>

          <p style={{ color: "#333", fontSize: 13, marginBottom: 32 }}>
            or{" "}
            <span onClick={() => navigate("/create")} style={{ color: "#e8e8e8", cursor: "pointer", textDecoration: "underline" }}>
              create a new poll
            </span>
          </p>

          <div
            onClick={() => navigate("/guess-game")}
            style={{
              background: "#0d0d0d", border: "1px solid #1a1a1a",
              borderRadius: 12, padding: "20px 24px",
              cursor: "pointer", textAlign: "left",
              transition: "border-color 0.2s"
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#333"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{
                  fontSize: 11, fontFamily: "'Space Mono', monospace",
                  letterSpacing: 2, color: "#f97316", marginBottom: 6,
                  textTransform: "uppercase"
                }}>New</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8e8", marginBottom: 4 }}>
                  Guessing Game
                </div>
                <div style={{ fontSize: 12, color: "#555" }}>
                  Pick a secret number. Play vs computer or a friend. Higher or lower?
                </div>
              </div>
              <span style={{ fontSize: 24, color: "#444" }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
