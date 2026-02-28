// Glitchy cyberpunk button component for OAuth authentication

import type { JSX } from "solid-js";
import "../styles/glitch.css";

interface GlitchyButtonProps {
  provider: "github";
  onClick?: () => void;
  disabled?: boolean;
}

const PROVIDER_CONFIG = {
  github: {
    label: "Authenticate with GitHub",
    icon: "⚡",
    class: "github",
  },
};

export default function GlitchyButton(props: GlitchyButtonProps): JSX.Element {
  const config = PROVIDER_CONFIG[props.provider];

  return (
    <button
      class={`glitch-btn scan-border ${config.class}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={config.label}
    >
      <span class="btn-icon">{config.icon}</span>
      <span class="btn-text">{config.label}</span>
    </button>
  );
}