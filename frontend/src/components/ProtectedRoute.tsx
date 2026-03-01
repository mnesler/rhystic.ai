// Protected route wrapper that requires authentication

import { Show, createEffect, type ParentComponent } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../context/AuthContext";

export const ProtectedRoute: ParentComponent = (props) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Create reactive effect to handle redirects when auth state is determined
  createEffect(() => {
    const isLoading = loading();
    const currentUser = user();
    
    // Only redirect when we've finished loading and there's no user
    if (!isLoading && !currentUser) {
      navigate("/", { replace: true });
    }
  });

  // Show loading while checking auth (reactive)
  return (
    <Show
      when={!loading()}
      fallback={
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
      }
    >
      <Show
        when={user()}
        fallback={null}
      >
        {props.children}
      </Show>
    </Show>
  );
};
