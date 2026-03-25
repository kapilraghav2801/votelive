import { useNavigate } from "react-router-dom"

export default function Navbar() {
  const navigate = useNavigate()

  return (
    <nav style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "16px 28px", borderBottom: "1px solid #1a1a1a",
      background: "rgba(10,10,10,0.95)", backdropFilter: "blur(12px)",
      position: "sticky", top: 0, zIndex: 100
    }}>
      <span
        onClick={() => navigate("/")}
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 15, fontWeight: 700, letterSpacing: 3,
          color: "#e8e8e8", cursor: "pointer"
        }}
      >
        VOTELIVE
      </span>
      <button
        onClick={() => navigate("/create")}
        style={{
          padding: "7px 18px", background: "#e8e8e8",
          color: "#000", border: "none", borderRadius: 6,
          fontWeight: 700, fontSize: 13, cursor: "pointer"
        }}
      >
        + Create Poll
      </button>
    </nav>
  )
}
