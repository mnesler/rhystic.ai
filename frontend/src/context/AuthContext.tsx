// Authentication context for managing user state across the app

import { createContext, useContext, createSignal, onMount, type ParentComponent, type Accessor } from "solid-js";

const API_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:3000";

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

  async function fetchUser() {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        // Token is invalid, clear it
        localStorage.removeItem("auth_token");
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to fetch user:", err);
      localStorage.removeItem("auth_token");
      setUser(null);
    } finally {
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
