// Protected route wrapper that requires authentication

import { Show, type ParentComponent } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../context/AuthContext";

export const ProtectedRoute: ParentComponent = (props) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Show loading while checking auth
  if (loading()) {
    return (
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          height: "100vh",
          background: "#0a0a0f",
          color: "#00ff41",
          "font-family": "'Courier New', monospace",
          "font-size": "1.2rem",
        }}
      >
        <div class="terminal-cursor">LOADING...</div>
      </div>
    );
  }

  // If not authenticated, redirect to landing page
  if (!user()) {
    navigate("/", { replace: true });
    return null;
  }

  // User is authenticated, render children
  return <>{props.children}</>;
};
