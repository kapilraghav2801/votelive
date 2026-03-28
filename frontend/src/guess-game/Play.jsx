import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import axios from "axios"
import Navbar from "../components/Navbar"
import API from "../constants/api"
import { getVoterId } from "../utils/voter"

const WS_BASE = API.replace("http", "ws")

export default function GuessGamePlay() {
  const { roomKey } = useParams()
  const navigate = useNavigate()
  const playerId = getVoterId()

  // Detect mode from sessionStorage (set by Setup.jsx)
  const gameMode = sessionStorage.getItem(`game_mode_${roomKey}`) || "computer"
  const isMultiplayer = gameMode === "multiplayer"

  // Phases: loading, waiting, select_range, pick_secret, playing, finished
  const [phase, setPhase] = useState("loading")
  const [gameData, setGameData] = useState(null)
  const [error, setError] = useState("")

  // Range info
  const [rangeMin, setRangeMin] = useState(1)
  const [rangeMax, setRangeMax] = useState(100)

  // Pick secret
  const [secretInput, setSecretInput] = useState("")
  const [submittingSecret, setSubmittingSecret] = useState(false)

  // Range selection (host only, multiplayer)
  const [selectedRange, setSelectedRange] = useState(0)
  const rangeOptions = [
    { label: "1 – 100", min: 1, max: 100 },
    { label: "1 – 500", min: 1, max: 500 },
    { label: "1 – 1000", min: 1, max: 1000 },
  ]

  // Guessing
  const [guessInput, setGuessInput] = useState("")
  const [submittingGuess, setSubmittingGuess] = useState(false)
  const [guesses, setGuesses] = useState([])

  // Turn info
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [currentTurnName, setCurrentTurnName] = useState("")

  // Timer
  const [timeLeft, setTimeLeft] = useState(10)
  const timerRef = useRef(null)

  // Result
  const [result, setResult] = useState(null)

  // WebSocket ref (multiplayer only)
  const wsRef = useRef(null)

  // Opponent info
  const [opponentName, setOpponentName] = useState("")
  const [opponentReady, setOpponentReady] = useState(false)
  const [mySecretLocked, setMySecretLocked] = useState(false)

  // Is this player the host?
  const [isHost, setIsHost] = useState(false)

  // Scroll ref
  const historyEndRef = useRef(null)

  // Load range from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(`game_range_${roomKey}`)
    if (saved) {
      const p = JSON.parse(saved)
      setRangeMin(p.min)
      setRangeMax(p.max)
    }
  }, [roomKey])

  // Scroll to bottom of guess history
  useEffect(() => {
    if (historyEndRef.current) historyEndRef.current.scrollIntoView({ behavior: "smooth" })
  }, [guesses])

  // Timer helper
  const startTimer = useCallback((seconds) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setTimeLeft(seconds)
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const rem = Math.max(0, seconds - (Date.now() - start) / 1000)
      setTimeLeft(Math.ceil(rem))
      if (rem <= 0) clearInterval(timerRef.current)
    }, 100)
  }, [])

  // ============================================================
  // COMPUTER MODE — REST-based (existing Phase 1 logic)
  // ============================================================

  useEffect(() => {
    if (isMultiplayer) return // skip for multiplayer

    const load = async () => {
      try {
        const res = await axios.get(`${API}/guess-game/${roomKey}/state`)
        const d = res.data
        setGameData(d)
        setGuesses(d.guesses || [])
        if (d.game_status === "picking_numbers") setPhase("pick_secret")
        else if (d.game_status === "playing") { setPhase("playing"); startTimer(d.guess_time_seconds || 10) }
        else if (d.game_status === "finished") { setPhase("finished"); setResult(d) }
      } catch { setError("Game not found"); setPhase("error") }
    }
    load()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [roomKey, isMultiplayer])

  const handleSubmitSecretComputer = async () => {
    const num = parseInt(secretInput)
    if (isNaN(num)) { setError("Enter a valid number"); return }
    setSubmittingSecret(true); setError("")
    try {
      const res = await axios.post(`${API}/guess-game/${roomKey}/secret`, { player_id: playerId, secret_number: num })
      setGameData(res.data); setPhase("playing"); startTimer(res.data.guess_time_seconds || 10)
    } catch (e) { setError(e.response?.data?.detail || "Failed") }
    setSubmittingSecret(false)
  }

  const handleSubmitGuessComputer = async () => {
    const num = parseInt(guessInput)
    if (isNaN(num)) { setError("Enter a valid number"); return }
    setSubmittingGuess(true); setError(""); setGuessInput("")
    try {
      const res = await axios.post(`${API}/guess-game/${roomKey}/guess`, { player_id: playerId, guess_number: num })
      const d = res.data
      setGameData(d); setGuesses(d.guesses || [])
      if (d.game_over) { setPhase("finished"); setResult(d); if (timerRef.current) clearInterval(timerRef.current) }
      else startTimer(d.guess_time_seconds || 10)
    } catch (e) { setError(e.response?.data?.detail || "Failed") }
    setSubmittingGuess(false)
  }

  // ============================================================
  // MULTIPLAYER MODE — WebSocket-based (Phase 2)
  // ============================================================

  useEffect(() => {
    if (!isMultiplayer) return

    const ws = new WebSocket(`${WS_BASE}/ws/guess-game/${roomKey}?player_id=${playerId}`)

    ws.onopen = () => {
      // If we're joining (not the host), send join_room
      const joinData = sessionStorage.getItem(`game_join_${roomKey}`)
      if (joinData) {
        const parsed = JSON.parse(joinData)
        ws.send(JSON.stringify({
          type: "join_room",
          player_id: parsed.player_id,
          player_name: parsed.player_name
        }))
        sessionStorage.removeItem(`game_join_${roomKey}`)
      }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        handleWsMessage(msg)
      } catch { /* ignore parse errors */ }
    }

    ws.onerror = () => {}
    ws.onclose = () => {}

    wsRef.current = ws

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      try { ws.close() } catch { /* */ }
    }
  }, [roomKey, isMultiplayer])

  const sendWs = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }

  const handleWsMessage = (msg) => {
    switch (msg.type) {
      case "game_state":
        handleGameState(msg)
        break
      case "player_joined":
        setOpponentName(msg.player_name)
        break
      case "pick_your_number":
        setRangeMin(msg.range_min)
        setRangeMax(msg.range_max)
        setPhase("pick_secret")
        break
      case "secret_locked":
        setMySecretLocked(true)
        break
      case "opponent_ready":
        setOpponentReady(true)
        break
      case "game_started":
        setPhase("playing")
        setIsMyTurn(msg.current_turn === playerId)
        setCurrentTurnName(msg.first_player_name)
        startTimer(msg.guess_time_seconds || 10)
        break
      case "guess_result":
        setGuesses(prev => [...prev, {
          player_id: msg.player_id,
          name: msg.player_name,
          number: msg.guess_number,
          result: msg.result
        }])
        setIsMyTurn(msg.current_turn === playerId)
        startTimer(msg.guess_time_seconds || 10)
        break
      case "turn_skipped":
        setIsMyTurn(msg.current_turn === playerId)
        startTimer(msg.guess_time_seconds || 10)
        break
      case "game_over":
        setPhase("finished")
        if (timerRef.current) clearInterval(timerRef.current)
        setResult({
          you_won: msg.winner === playerId,
          winner_name: msg.winner_name,
          player1_secret: msg.player1_secret,
          player2_secret: msg.player2_secret,
          total_guesses: msg.total_guesses,
          message: msg.winner === playerId ? "You guessed it!" : `${msg.winner_name} guessed your number!`
        })
        break
      case "opponent_disconnected":
        setError("Your opponent disconnected")
        break
      case "error":
        setError(msg.message)
        break
    }
  }

  const handleGameState = (state) => {
    setGuesses(state.guesses || [])

    // Determine if I'm host
    if (state.player1 && state.player1.player_id === playerId) setIsHost(true)
    if (state.player2 && state.player2.player_id !== playerId && state.player2.name) {
      setOpponentName(state.player2.name)
    }
    if (state.player1 && state.player1.player_id !== playerId && state.player1.name) {
      setOpponentName(state.player1.name)
    }

    setRangeMin(state.range_min || 1)
    setRangeMax(state.range_max || 100)

    // Set phase based on status
    switch (state.status) {
      case "waiting_for_player2":
        setPhase("waiting")
        break
      case "picking_range":
        setPhase("select_range")
        break
      case "picking_numbers":
        setPhase("pick_secret")
        break
      case "playing":
        setPhase("playing")
        setIsMyTurn(state.current_turn === playerId)
        break
      case "finished":
        setPhase("finished")
        break
    }
  }

  // Multiplayer actions
  const handleSelectRange = () => {
    const r = rangeOptions[selectedRange]
    sendWs({ type: "select_range", player_id: playerId, range_min: r.min, range_max: r.max })
  }

  const handleSubmitSecretMultiplayer = () => {
    const num = parseInt(secretInput)
    if (isNaN(num)) { setError("Enter a valid number"); return }
    setError("")
    sendWs({ type: "submit_secret", player_id: playerId, secret_number: num })
    setSecretInput("")
  }

  const handleSubmitGuessMultiplayer = () => {
    const num = parseInt(guessInput)
    if (isNaN(num)) { setError("Enter a valid number"); return }
    setError(""); setGuessInput("")
    sendWs({ type: "submit_guess", player_id: playerId, guess_number: num })
  }

  // Unified handlers
  const onSubmitSecret = isMultiplayer ? handleSubmitSecretMultiplayer : handleSubmitSecretComputer
  const onSubmitGuess = isMultiplayer ? handleSubmitGuessMultiplayer : handleSubmitGuessComputer
  const onKey = (e, fn) => { if (e.key === "Enter") fn() }

  // ============================================================
  // RENDER
  // ============================================================

  if (phase === "error") return (
    <Shell>
      <div style={{ textAlign: "center", padding: "80px 24px" }}>
        <p style={{ color: "#555", fontFamily: "'Space Mono', monospace", fontSize: 13 }}>{error || "Game not found"}</p>
        <button onClick={() => navigate("/guess-game")} style={btnPrimary}>New Game</button>
      </div>
    </Shell>
  )

  if (phase === "loading") return (
    <Shell>
      <div style={{ textAlign: "center", padding: "80px 24px", color: "#444" }}>Loading...</div>
    </Shell>
  )

  return (
    <Shell>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 3, color: "#444" }}>
            GAME · {roomKey.toUpperCase()}
            {isMultiplayer && <span style={{ color: "#f97316", marginLeft: 8 }}>2P</span>}
          </div>
          {phase === "playing" && (
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 14,
              color: timeLeft <= 3 ? "#ff4444" : "#888",
              padding: "4px 14px", border: "1px solid #1a1a1a",
              borderRadius: 20, fontWeight: 700
            }}>{timeLeft}s</div>
          )}
          {phase === "finished" && (
            <div style={{
              fontFamily: "'Space Mono', monospace", fontSize: 12,
              color: "#ff4444", padding: "4px 12px",
              border: "1px solid #1a1a1a", borderRadius: 20
            }}>FINISHED</div>
          )}
        </div>

        {/* ===== WAITING FOR OPPONENT ===== */}
        {phase === "waiting" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Waiting for opponent...</h2>
            <p style={{ fontSize: 13, color: "#555", marginBottom: 28 }}>Share this room key:</p>
            <div style={{
              fontSize: 32, fontWeight: 700, letterSpacing: 8,
              fontFamily: "'Space Mono', monospace", color: "#e8e8e8",
              padding: "16px 0", marginBottom: 16
            }}>
              {roomKey.toUpperCase()}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(roomKey)}
              style={{ ...btnOutline, fontSize: 13 }}
            >
              Copy Key
            </button>
            <div style={{
              marginTop: 40, width: 24, height: 24, margin: "40px auto 0",
              border: "2px solid #1a1a1a", borderTop: "2px solid #e8e8e8",
              borderRadius: "50%", animation: "spin 0.8s linear infinite"
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ===== SELECT RANGE (host only, multiplayer) ===== */}
        {phase === "select_range" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              {isHost ? "Choose the range" : "Waiting for host to pick range..."}
            </h2>
            {opponentName && (
              <p style={{ fontSize: 13, color: "#4ade80", marginBottom: 20 }}>
                {opponentName} joined!
              </p>
            )}
            {isHost ? (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {rangeOptions.map((r, i) => (
                    <button key={i} onClick={() => setSelectedRange(i)} style={{
                      flex: 1, padding: "10px 0",
                      background: selectedRange === i ? "#e8e8e8" : "#111",
                      color: selectedRange === i ? "#000" : "#888",
                      border: selectedRange === i ? "1px solid #e8e8e8" : "1px solid #1e1e1e",
                      borderRadius: 8, cursor: "pointer", fontWeight: selectedRange === i ? 700 : 400,
                      fontSize: 13, fontFamily: "'Space Mono', monospace"
                    }}>{r.label}</button>
                  ))}
                </div>
                <button onClick={handleSelectRange} style={{ ...btnPrimary, width: "100%" }}>
                  Confirm Range
                </button>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#555" }}>The host is choosing...</p>
            )}
          </div>
        )}

        {/* ===== PICK SECRET ===== */}
        {phase === "pick_secret" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Pick your secret number</h2>
            <p style={{ fontSize: 13, color: "#555", marginBottom: 20 }}>
              Choose between{" "}
              <span style={{ color: "#e8e8e8", fontFamily: "'Space Mono', monospace" }}>{rangeMin}</span> and{" "}
              <span style={{ color: "#e8e8e8", fontFamily: "'Space Mono', monospace" }}>{rangeMax}</span>.
            </p>

            {mySecretLocked ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ color: "#4ade80", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  Your number is locked!
                </p>
                <p style={{ color: "#555", fontSize: 13 }}>
                  {opponentReady ? "Both ready — starting..." : "Waiting for opponent to pick..."}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <input
                    type="number" placeholder="Your secret number"
                    value={secretInput}
                    onChange={e => { setSecretInput(e.target.value); setError("") }}
                    onKeyDown={e => onKey(e, onSubmitSecret)}
                    min={rangeMin} max={rangeMax}
                    style={{ ...inputStyle, flex: 1, fontSize: 18, textAlign: "center", fontFamily: "'Space Mono', monospace", letterSpacing: 4 }}
                    autoFocus
                  />
                </div>
                <button onClick={onSubmitSecret} disabled={submittingSecret}
                  style={{ ...btnPrimary, width: "100%", opacity: submittingSecret ? 0.5 : 1 }}>
                  {submittingSecret ? "Locking..." : "Lock In"}
                </button>
              </>
            )}
            {error && <p style={errStyle}>{error}</p>}
          </div>
        )}

        {/* ===== PLAYING ===== */}
        {phase === "playing" && (
          <div>
            {/* Guess history */}
            <div style={{
              background: "#0d0d0d", border: "1px solid #1a1a1a",
              borderRadius: 10, padding: "12px 16px",
              marginBottom: 20, maxHeight: 320, overflowY: "auto"
            }}>
              <div style={{ fontSize: 10, color: "#444", marginBottom: 10, fontFamily: "'Space Mono', monospace", letterSpacing: 2 }}>
                GUESS HISTORY
              </div>
              {guesses.length === 0 && (
                <p style={{ fontSize: 13, color: "#333", fontStyle: "italic" }}>No guesses yet.</p>
              )}
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} isYou={g.player_id === playerId} isLast={i === guesses.length - 1} />
              ))}
              <div ref={historyEndRef} />
            </div>

            {/* Input or waiting message */}
            {(isMultiplayer && !isMyTurn) ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <p style={{ color: "#888", fontSize: 14, fontFamily: "'Space Mono', monospace" }}>
                  Opponent is guessing...
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontFamily: "'Space Mono', monospace" }}>
                  Your turn — guess {isMultiplayer ? "their" : "the computer's"} number
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    type="number" placeholder="Your guess"
                    value={guessInput}
                    onChange={e => { setGuessInput(e.target.value); setError("") }}
                    onKeyDown={e => onKey(e, onSubmitGuess)}
                    min={rangeMin} max={rangeMax}
                    style={{ ...inputStyle, flex: 1, fontSize: 18, textAlign: "center", fontFamily: "'Space Mono', monospace", letterSpacing: 4 }}
                    autoFocus
                  />
                  <button onClick={onSubmitGuess} disabled={submittingGuess}
                    style={{ ...btnPrimary, padding: "12px 24px", opacity: submittingGuess ? 0.5 : 1 }}>
                    {submittingGuess ? "..." : "Guess"}
                  </button>
                </div>
              </div>
            )}
            {error && <p style={errStyle}>{error}</p>}
          </div>
        )}

        {/* ===== FINISHED ===== */}
        {phase === "finished" && result && (
          <div>
            <div style={{ textAlign: "center", padding: "28px 20px", background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 12, marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{result.you_won ? "🏆" : (isMultiplayer ? "😔" : "💻")}</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: result.you_won ? "#4ade80" : "#f97316" }}>
                {result.you_won ? "You Won!" : `${result.winner_name || "Opponent"} Won!`}
              </h2>
              <p style={{ fontSize: 13, color: "#555" }}>{result.message}</p>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <SecretCard label="YOUR SECRET" value={result.player1_secret} />
              <SecretCard label={isMultiplayer ? "THEIR SECRET" : "COMPUTER'S SECRET"} value={result.player2_secret} />
            </div>

            <div style={{ padding: "12px 16px", background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{result.total_guesses}</div>
              <div style={{ fontSize: 10, color: "#555", fontFamily: "'Space Mono', monospace" }}>TOTAL GUESSES</div>
            </div>

            <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: "12px 16px", marginBottom: 24, maxHeight: 240, overflowY: "auto" }}>
              <div style={{ fontSize: 10, color: "#444", marginBottom: 10, fontFamily: "'Space Mono', monospace", letterSpacing: 2 }}>FULL HISTORY</div>
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} isYou={g.player_id === playerId} isLast={i === guesses.length - 1} small />
              ))}
            </div>

            <button onClick={() => navigate("/guess-game")} style={{ ...btnPrimary, width: "100%" }}>Play Again</button>
          </div>
        )}
      </div>
    </Shell>
  )
}

// ============ Shared Components ============

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Navbar />
      {children}
    </div>
  )
}

function GuessRow({ guess, isYou, isLast, small }) {
  const g = guess
  const arrowColor = g.result === "correct" ? "#4ade80" : g.result === "higher" ? "#f97316" : "#3b82f6"
  const arrow = g.result === "higher" ? "↑ higher" : g.result === "lower" ? "↓ lower" : "✓ CORRECT"
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: small ? "4px 0" : "6px 0",
      borderBottom: isLast ? "none" : "1px solid #111"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: small ? 11 : 10, color: isYou ? "#888" : "#555", fontFamily: "'Space Mono', monospace", minWidth: small ? 80 : 90 }}>
          {isYou ? "You" : g.name}
        </span>
        <span style={{ fontSize: small ? 13 : 16, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: g.result === "correct" ? "#4ade80" : "#e8e8e8" }}>
          {g.number}
        </span>
      </div>
      <span style={{ fontSize: small ? 11 : 13, fontWeight: 700, color: arrowColor, fontFamily: "'Space Mono', monospace" }}>
        {arrow}
      </span>
    </div>
  )
}

function SecretCard({ label, value }) {
  return (
    <div style={{ flex: 1, padding: "16px", background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#e8e8e8" }}>{value ?? "—"}</div>
    </div>
  )
}

// ============ Styles ============
const inputStyle = { padding: "12px 14px", background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, color: "#e8e8e8", outline: "none" }
const btnPrimary = { padding: "14px 24px", background: "#e8e8e8", color: "#000", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }
const btnOutline = { padding: "10px 20px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#888", cursor: "pointer" }
const errStyle = { color: "#ff4444", fontSize: 13, marginTop: 10 }
