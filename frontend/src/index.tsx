import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import App from "./App.jsx";

render(
  () => (
    <AuthProvider>
      <Router>
        <Route path="/" component={Landing} />
        <Route path="/auth" component={Auth} />
        <Route
          path="/app"
          component={() => (
            <ProtectedRoute>
              <App />
            </ProtectedRoute>
          )}
        />
      </Router>
    </AuthProvider>
  ),
  document.getElementById("root")!
);
