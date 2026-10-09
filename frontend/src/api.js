import { API } from "./lib";

const KEY = "kharcha-session";

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session lasts until the tab closes */
  }
}

export async function call(path, { method = "GET", body, token } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check that the API is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again."
    );
    err.status = res.status;
    throw err;
  }
  return data;
}