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
    // Timeout fallback — ensure loading is cleared even if fetch hangs
    const timeoutId = setTimeout(() => setLoading(false), 5000);

    try {
      // Token comes from the JS-readable cookie set by the backend after OAuth.
      // Cookie is the primary source; localStorage is a same-origin fallback for
      // cases where the cookie has already been consumed (e.g. cross-tab).
      // We never proactively mirror the cookie into localStorage — that widens
      // the XSS attack surface without adding security value.
      const token = getCookie("auth_token_js") || localStorage.getItem("auth_token");

      if (!token) {
        setLoading(false);
        clearTimeout(timeoutId);
        return;
      }

      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });

      if (response.ok) {
        const userData = await response.json() as User;
        setUser(userData);
      } else {
        localStorage.removeItem("auth_token");
        setUser(null);
      }
    } catch {
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
    } catch {
      // best-effort — clear local state regardless
    }

    // Clear all local token storage
    localStorage.removeItem("auth_token");
    document.cookie = "auth_token_js=; Max-Age=0; path=/";
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
