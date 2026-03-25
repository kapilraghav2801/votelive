import { useState } from "react"
import { useNavigate } from "react-router-dom"
import Navbar from "../components/Navbar"

export default function Home() {
  const [roomKey, setRoomKey] = useState("")
  const [error, setError] = useState("")
  const navigate = useNavigate()

  const join = () => {
    if (!roomKey.trim()) { setError("Enter a room key"); return }
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

          {/* Hero */}
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

          {/* Join box */}
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
            <div style={{ display: "flex", gap: 10 }}>
              <input
                placeholder="Enter room key (e.g. abc123)"
                value={roomKey}
                onChange={e => { setRoomKey(e.target.value); setError("") }}
                onKeyDown={e => e.key === "Enter" && join()}
                style={{
                  flex: 1, padding: "11px 14px",
                  background: "#111", border: "1px solid #222",
                  borderRadius: 8, color: "#e8e8e8",
                  fontSize: 14, outline: "none",
                  letterSpacing: 2, fontFamily: "'Space Mono', monospace"
                }}
              />
              <button onClick={join} style={{
                padding: "11px 20px", background: "#e8e8e8",
                color: "#000", border: "none", borderRadius: 8,
                fontWeight: 700, fontSize: 14, cursor: "pointer"
              }}>
                Join
              </button>
            </div>
            {error && <p style={{ color: "#ff4444", fontSize: 12, marginTop: 8 }}>{error}</p>}
          </div>

          <p style={{ color: "#333", fontSize: 13 }}>
            or{" "}
            <span
              onClick={() => navigate("/create")}
              style={{ color: "#e8e8e8", cursor: "pointer", textDecoration: "underline" }}
            >
              create a new poll
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
