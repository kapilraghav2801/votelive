import { useEffect, useState } from "react"
import axios from "axios"
import API from "../constants/api"

const facts = [
  "Small groups waste 15+ minutes on simple decisions every day.",
  "VoteLive gives you a result in under 60 seconds.",
  "Anonymous voting removes social pressure and bias.",
  "Blind mode hides results until the poll closes — no bandwagon effect.",
  "Built with FastAPI, Redis Sorted Sets, and WebSocket fan-out.",
]

export default function WakeUp({ children }) {
  const [status, setStatus] = useState("checking")
  const [factIndex, setFactIndex] = useState(0)

  useEffect(() => {
    let factTimer
    const check = async () => {
      try {
        await axios.get(`${API}/polls/`, { timeout: 4000 })
        setStatus("ready")
      } catch {
        setStatus("waking")
        factTimer = setInterval(() => {
          setFactIndex(p => (p + 1) % facts.length)
        }, 3000)
        const retry = setInterval(async () => {
          try {
            await axios.get(`${API}/polls/`, { timeout: 4000 })
            setStatus("ready")
            clearInterval(retry)
            clearInterval(factTimer)
          } catch {}
        }, 4000)
      }
    }
    check()
    return () => clearInterval(factTimer)
  }, [])

  if (status === "ready") return children

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 32
    }}>
      <div style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: 18, fontWeight: 700, letterSpacing: 3,
        color: "#e8e8e8", marginBottom: 48
      }}>
        VOTELIVE
      </div>
      <div style={{
        width: 32, height: 32,
        border: "2px solid #1a1a1a",
        borderTop: "2px solid #e8e8e8",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        marginBottom: 24
      }} />
      {status === "checking" && (
        <p style={{ color: "#444", fontSize: 13, fontFamily: "'Space Mono', monospace" }}>
          connecting...
        </p>
      )}
      {status === "waking" && (
        <>
          <p style={{ color: "#555", fontSize: 12, marginBottom: 4, fontFamily: "'Space Mono', monospace" }}>
            backend waking up · ~20s
          </p>
          <p style={{ color: "#333", fontSize: 11, marginBottom: 36, fontFamily: "'Space Mono', monospace" }}>
            render.com free tier
          </p>
          <div style={{
            maxWidth: 420, padding: "18px 24px",
            border: "1px solid #1a1a1a", borderRadius: 10,
            background: "#0d0d0d", textAlign: "center"
          }}>
            <p style={{ fontSize: 13, color: "#666", lineHeight: 1.7, fontStyle: "italic" }}>
              "{facts[factIndex]}"
            </p>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
