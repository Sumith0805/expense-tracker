import { useState } from "react";
import { call } from "./api";

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const register = mode === "register";

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (register && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await call(`/auth/${mode}`, { method: "POST", body: { email, password } });
      onAuth({ token: res.token, email: res.email });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1 className="headline small">{register ? "Create your account" : "Welcome back"}</h1>
      <p className="sub">
        {register
          ? "An account lets you save your expenses and open them again later. Nothing is saved unless you choose to."
          : "Sign in to open the expenses you saved."}
      </p>

      <div className="seg-ctl" role="tablist" aria-label="Sign in or register">
        <button
          role="tab"
          aria-selected={!register}
          className={!register ? "on" : ""}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          Sign in
        </button>
        <button
          role="tab"
          aria-selected={register}
          className={register ? "on" : ""}
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Register
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {register && <small>Use at least 8 characters.</small>}
        </div>
        {register && (
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
        </button>
      </form>
    </main>
  );
}