// Authentication context for managing user state across the app

import { createContext, useContext, createSignal, onMount, type ParentComponent, type Accessor } from "solid-js";

const API_URL = "";

export interface User {
  id: number;
  email: string;
  name: string;
  avatar?: string;
}

interface AuthContextValue {
  user: Accessor<User | null>;
  loading: Accessor<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();

export const AuthProvider: ParentComponent = (props) => {
  const [user, setUser] = createSignal<User | null>(null);
  const [loading, setLoading] = createSignal(true);

  function getCookie(name: string): string | null {
    return document.cookie
      .split("; ")
      .find((c) => c.startsWith(name + "="))
      ?.split("=")[1] ?? null;
  }

  async function fetchUser() {
    // Timeout fallback - ensure loading is set to false after 5 seconds
    const timeoutId = setTimeout(() => {
      console.log("[Auth] timeout, setting loading false");
      setLoading(false);
    }, 5000);

    try {
      // Check for token in URL first (from OAuth redirect)
      const urlParams = new URLSearchParams(window.location.search);
      let token = urlParams.get("token");
      if (token) {
        console.log("[Auth] token from URL:", token.substring(0, 20) + "...");
        localStorage.setItem("auth_token", token);
        window.history.replaceState({}, "", window.location.pathname);
      }
      
      // Fallback to cookie or localStorage
      if (!token) {
        token = getCookie("auth_token_js") || localStorage.getItem("auth_token");
      }
      
      // If we got token from cookie, store in localStorage for consistency
      if (token && !localStorage.getItem("auth_token")) {
        localStorage.setItem("auth_token", token);
      }
      
      if (!token) {
        console.log("[Auth] no token found");
        clearTimeout(timeoutId);
        setLoading(false);
        return;
      }

      console.log("[Auth] calling /auth/me with token:", token.substring(0, 20) + "...");
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });

      console.log("[Auth] response status:", response.status);

      if (response.ok) {
        const userData = await response.json();
        console.log("[Auth] user data:", userData);
        setUser(userData);
      } else {
        console.log("[Auth] token invalid");
        localStorage.removeItem("auth_token");
        setUser(null);
      }
    } catch (err) {
      console.error("[Auth] fetch error:", err);
      localStorage.removeItem("auth_token");
      setUser(null);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  async function logout() {
    const token = localStorage.getItem("auth_token");
    
    // Call logout endpoint to clear server-side cookies
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
    } catch (err) {
      console.error("Logout API call failed:", err);
    }

    // Clear local state
    localStorage.removeItem("auth_token");
    setUser(null);
  }

  onMount(() => {
    fetchUser();
  });

  const value: AuthContextValue = {
    user,
    loading,
    logout,
    refreshUser: fetchUser,
  };

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
