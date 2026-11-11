import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    async login(email, password) {
      const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
      setUser(data.user);
      return data.user;
    },
    async logout() {
      await api("/api/auth/logout", { method: "POST" });
      setUser(null);
    },
    applyUser(next) {
      setUser(next);
    },
  }), [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const DICOM_ROLES = new Set(["system_admin", "facility_admin", "radiologist", "technologist"]);

export function canReadDicom(user) {
  return Boolean(user && DICOM_ROLES.has(user.role));
}

export function homeFor(user) {
  if (!user) return "/login";
  if (user.mustChangePassword) return "/settings";
  if (user.role === "radiologist") return "/my-worklist";
  if (user.role === "technologist") return "/studies";
  if (user.role === "referring_physician") return "/reports";
  return "/dashboard";
}

export function useAuth() {
  return useContext(AuthContext);
}
