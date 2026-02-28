// Glitchy industrial landing page with OAuth authentication

import { createSignal, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import GlitchyButton from "../components/GlitchyButton";
import "../styles/glitch.css";

const API_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:3000";

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    // Check if already authenticated
    const token = localStorage.getItem("auth_token");
    if (token) {
      navigate("/app", { replace: true });
    }

    // Check for OAuth error in URL
    if (searchParams.error) {
      if (searchParams.error === "github_auth_failed") {
        setError("GitHub authentication failed. Please try again.");
      }
    }
  });

  function handleGitHubAuth() {
    window.location.href = `${API_URL}/auth/github`;
  }

  return (
    <div class="crt-screen" style={{ "min-height": "100vh", width: "100%" }}>
      {/* Noise overlay */}
      <div class="noise-overlay" />

      {/* Printer calibration marks */}
      <div class="printer-marks" />
      <div class="printer-marks-corner top-left" />
      <div class="printer-marks-corner top-right" />
      <div class="printer-marks-corner bottom-left" />
      <div class="printer-marks-corner bottom-right" />

      {/* Data rain background effect */}
      <div class="data-rain" />

      {/* Main content */}
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "100vh",
          padding: "40px 20px",
          "text-align": "center",
          position: "relative",
          "z-index": 10,
        }}
      >
        {/* Main title with glitch effect */}
        <h1 class="glitch-title vhs-distort" data-text="RHYSTIC STUDY">
          RHYSTIC STUDY
        </h1>

        {/* Tagline with flicker */}
        <p
          class="terminal-text flicker terminal-cursor"
          style={{
            "margin-top": "24px",
            "font-size": "1.2rem",
            "letter-spacing": "0.15em",
          }}
        >
          DID YOU PAY THE 1?
        </p>

        {/* Subtitle */}
        <p
          class="terminal-text"
          style={{
            "margin-top": "16px",
            opacity: 0.7,
            "font-size": "0.85rem",
          }}
        >
          MTG DECK ANALYSIS SYSTEM v2.0.77
        </p>

        {/* Error message */}
        <Show when={error()}>
          <div
            class="error-flash"
            style={{
              "margin-top": "32px",
              padding: "12px 24px",
              background: "rgba(255, 0, 64, 0.15)",
              border: "1px solid var(--glitch-red)",
              "border-radius": "4px",
              color: "var(--glitch-red)",
              "font-family": "'Courier New', monospace",
              "font-size": "0.9rem",
            }}
          >
            ⚠ {error()}
          </div>
        </Show>

        {/* Authentication buttons */}
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "20px",
            "margin-top": "64px",
          }}
        >
          <div class="hologram" style={{ padding: "2px", "border-radius": "4px" }}>
            <GlitchyButton provider="github" onClick={handleGitHubAuth} />
          </div>
        </div>

        {/* Footer text */}
        <div
          class="terminal-text terminal-prompt"
          style={{
            "margin-top": "80px",
            opacity: 0.5,
            "font-size": "0.75rem",
          }}
        >
          INITIALIZING AUTHENTICATION PROTOCOL
        </div>
      </div>
    </div>
  );
}
