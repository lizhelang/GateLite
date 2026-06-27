import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface StoredAuth {
  authorization: string;
  subject: string;
  method: "basic";
}

interface AuthContextValue {
  auth: StoredAuth | null;
  isAuthenticated: boolean;
  signIn: (username: string, password: string) => StoredAuth;
  signOut: () => void;
}

const storageKey = "gatelite.auth";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth());

  const signIn = (username: string, password: string) => {
    const next = createBasicAuth(username, password);
    writeStoredAuth(next);
    setAuth(next);
    return next;
  };

  const signOut = () => {
    clearStoredAuth();
    setAuth(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      isAuthenticated: Boolean(auth),
      signIn,
      signOut
    }),
    [auth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}

export function getAuthHeader(): string | undefined {
  return readStoredAuth()?.authorization;
}

export function clearStoredAuth() {
  window.sessionStorage.removeItem(storageKey);
}

function createBasicAuth(username: string, password: string): StoredAuth {
  return {
    authorization: `Basic ${encodeBase64(`${username}:${password}`)}`,
    subject: username,
    method: "basic"
  };
}

function readStoredAuth(): StoredAuth | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || "null") as StoredAuth | null;
    if (parsed?.method === "basic" && parsed.authorization.startsWith("Basic ") && parsed.subject) return parsed;
  } catch {
    // Ignore malformed session state and ask the user to sign in again.
  }
  return null;
}

function writeStoredAuth(auth: StoredAuth) {
  window.sessionStorage.setItem(storageKey, JSON.stringify(auth));
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}
