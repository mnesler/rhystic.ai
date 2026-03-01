// OAuth callback handler - tokens are now delivered via cookie, not URL params.
// This route exists only to catch any stale redirects and forward to /app.

import { onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import "../styles/glitch.css";

export default function Auth() {
  const navigate = useNavigate();

  onMount(() => {
    // Auth state is hydrated from the auth_token_js cookie in AuthContext.
    // Nothing to extract from the URL — just go to the app.
    navigate("/app", { replace: true });
  });

  return (
    <div class="crt-screen" style={{ "min-height": "100vh", width: "100%" }}>
      <div class="noise-overlay" />

      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "100vh",
          padding: "40px 20px",
        }}
      >
        <div class="decrypt-text">
          DECRYPTING ACCESS...
        </div>

        <div
          class="terminal-text"
          style={{
            "margin-top": "24px",
            opacity: 0.7,
          }}
        >
          <span class="terminal-cursor">VERIFYING CREDENTIALS</span>
        </div>

        {/* Loading animation */}
        <div
          style={{
            "margin-top": "40px",
            display: "flex",
            gap: "8px",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              style={{
                width: "8px",
                height: "40px",
                background: "var(--glitch-cyan)",
                animation: `bar-wave 1s ease-in-out infinite ${i * 0.1}s`,
                "box-shadow": "0 0 10px var(--glitch-cyan)",
              }}
            />
          ))}
        </div>
      </div>

      <style>
        {`
          @keyframes bar-wave {
            0%, 100% { transform: scaleY(0.3); }
            50% { transform: scaleY(1); }
          }
        `}
      </style>
    </div>
  );
}
