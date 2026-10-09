import { useEffect, useMemo, useRef, useState } from "react";
import { API, CAT_COLORS, fmtDate, inr, inrExact } from "./lib";
import { call, loadSession, saveSession } from "./api";
import AnimatedAmount from "./AnimatedAmount";
import AuthPage from "./AuthPage";
import { MonthChart, Unusual, monthLabel } from "./Insights";
import ManualEntry from "./ManualEntry";
import Settings from "./Settings";
import { Back, Chart, Home, Moon, Sliders, Sun } from "./icons";
import { applyTheme, readPref, resolve } from "./theme";

const CAT_NAMES = Object.keys(CAT_COLORS);

function useRoute() {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  const moved = useRef(false);

  useEffect(() => {
    const on = () => {
      moved.current = true;
      setRoute(read());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = (path) => {
    if (read() === path) {
      window.scrollTo(0, 0);
      return;
    }
    window.location.hash = path;
  };

  const back = () => {
    if (moved.current) window.history.back();
    else window.location.replace("#/");
  };

  return [route, go, back];
}

export default function App() {
  const [route, go, back] = useRoute();
  const view =
    route === "/results"
      ? "results"
      : route === "/settings"
      ? "settings"
      : route === "/account"
      ? "account"
      : "home";

  const [pref, setPref] = useState(readPref);
  const [dark, setDark] = useState(() => resolve(readPref()) === "dark");
  const [session, setSession] = useState(loadSession);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [cat, setCat] = useState(null);
  const [month, setMonth] = useState(null);
  const [query, setQuery] = useState("");
  const [over, setOver] = useState(false);
  const [manual, setManual] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [hover, setHover] = useState(null);
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const fileRef = useRef(null);

  const token = session?.token;

  function say(msg) {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }

  useEffect(() => {
    applyTheme(pref);
    setDark(resolve(pref) === "dark");
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      applyTheme("system");
      setDark(mq.matches);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    if (view === "results" && !data) window.location.replace("#/");
    if (view === "account" && session) window.location.replace("#/settings");
  }, [view, data, session]);

  function signOut(msg) {
    setSession(null);
    saveSession(null);
    if (msg !== false) say(typeof msg === "string" ? msg : "You are signed out.");
  }

  async function authed(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401) {
        signOut("Your session expired. Please sign in again.");
        go("/account");
      } else {
        say(e.message);
      }
      return null;
    }
  }

  function onAuth(s) {
    setSession(s);
    saveSession(s);
    say(`Signed in as ${s.email}.`);
    go(data ? "/results" : "/");
  }

  async function analyze(file) {
    setBusy(true);
    setError("");
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API}/analyze`, { method: "POST", body });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || "The server could not read that file.");
      }
      setData(await res.json());
      setCat(null);
      setMonth(null);
      setQuery("");
      setOverrides({});
      go("/results");
    } catch (e) {
      setError(
        e.message === "Failed to fetch"
          ? "Can't reach the analysis server. Check that the API is running on port 8000."
          : e.message
      );
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setBusy(false);
    }
  }

  async function useSample() {
    try {
      const res = await fetch("/sample.csv");
      const blob = await res.blob();
      await analyze(new File([blob], "sample.csv", { type: "text/csv" }));
    } catch {
      setError("Could not load the sample file.");
    }
  }

  async function loadSaved() {
    setBusy(true);
    const res = await authed(() => call("/expenses/analysis", { token }));
    setBusy(false);
    if (!res) return;
    if (!res.rows) {
      say("You haven't saved any expenses yet.");
      return;
    }
    setData(res);
    setCat(null);
    setMonth(null);
    setQuery("");
    setOverrides({});
    go("/results");
  }

  async function saveToAccount() {
    setSaving(true);
    const payload = txns.map((t) => ({
      date: t.date,
      description: String(t.description),
      amount: t.amount,
      category: t.category,
    }));
    const res = await authed(() => call("/expenses", { method: "PUT", body: payload, token }));
    setSaving(false);
    if (res) say(`Saved ${res.saved} transactions to your account.`);
  }

  async function deleteSaved() {
    const res = await authed(() => call("/expenses", { method: "DELETE", token }));
    if (res) say("Your saved expenses were deleted.");
  }

  async function deleteAccount() {
    const res = await authed(() => call("/auth/me", { method: "DELETE", token }));
    if (res) {
      signOut(false);
      say("Your account and saved expenses were deleted.");
      go("/");
    }
  }

  function changeCat(t, value) {
    setOverrides((o) => ({ ...o, [t._i]: value }));
    setFlash({ i: t._i, color: CAT_COLORS[value] || "#5a6784" });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1100);
  }

  function clearData() {
    setData(null);
    setOverrides({});
    setCat(null);
    setMonth(null);
    setQuery("");
    setManual(false);
    go("/");
  }

  const txns = useMemo(
    () =>
      data
        ? data.transactions.map((t, i) => ({ ...t, _i: i, category: overrides[i] || t.category }))
        : [],
    [data, overrides]
  );

  const scoped = useMemo(
    () => (month ? txns.filter((t) => String(t.date).startsWith(month)) : txns),
    [txns, month]
  );

  const cats = useMemo(() => {
    const m = {};
    scoped.forEach((t) => {
      m[t.category] = (m[t.category] || 0) + t.amount;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const catMap = useMemo(() => Object.fromEntries(cats), [cats]);
  const order = useMemo(
    () => (data ? [...new Set([...Object.keys(data.by_category), ...CAT_NAMES])] : []),
    [data]
  );

  const scopedTotal = useMemo(() => scoped.reduce((s, t) => s + t.amount, 0), [scoped]);
  const activeCat = cat && catMap[cat] > 0 ? cat : null;
  const lit = hover || activeCat;
  const monthKeys = data ? Object.keys(data.monthly_totals) : [];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(
      (t) =>
        (!activeCat || t.category === activeCat) &&
        (!q || String(t.description).toLowerCase().includes(q))
    );
  }, [scoped, activeCat, query]);

  const focus = useMemo(() => {
    if (!activeCat) return null;
    const items = scoped.filter((t) => t.category === activeCat);
    if (!items.length) return null;
    const sum = items.reduce((s, t) => s + t.amount, 0);
    return {
      count: items.length,
      avg: sum / items.length,
      max: Math.max(...items.map((t) => t.amount)),
    };
  }, [scoped, activeCat]);

  function exportCsv() {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = txns.map((t) => [t.date, esc(t.description), t.amount, t.category].join(","));
    const csv = ["date,description,amount,category", ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kharcha-categorised.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const catCell = (t) => (
    <span className="cat">
      <span className="dot" style={{ background: CAT_COLORS[t.category] || "#5a6784" }} />
      <select
        className="catsel"
        value={t.category}
        aria-label={`Category for ${t.description}`}
        onChange={(e) => changeCat(t, e.target.value)}
      >
        {CAT_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {overrides[t._i] && <small className="edited">edited</small>}
    </span>
  );

  const flashProps = (t) =>
    flash && flash.i === t._i ? { className: "flash", style: { "--flash": flash.color } } : {};

  const editedCount = Object.keys(overrides).length;

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="topbar-left">
          {view !== "home" && (
            <button className="icon-btn" onClick={back} aria-label="Go back">
              <Back />
            </button>
          )}
          <button className="mark" onClick={() => go("/")} aria-label="Kharcha home">
            Kharcha
          </button>
        </div>
        <div className="topbar-right">
          {view === "results" && (
            <button className="btn ghost hide-sm" onClick={() => go("/")}>
              Analyse another file
            </button>
          )}
          {!session && view !== "account" && (
            <button className="btn ghost" onClick={() => go("/account")}>
              Sign in
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setPref(dark ? "light" : "dark")}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          <button
            className="icon-btn hide-sm"
            onClick={() => go("/settings")}
            aria-label="Settings"
            title="Settings"
          >
            <Sliders />
          </button>
        </div>
      </header>

      {view === "account" && !session && <AuthPage onAuth={onAuth} />}

      {view === "home" && (
        <main>
          <h1 className="headline">Find out where your money goes each month.</h1>
          <p className="lede">
            Drop in a bank or UPI statement as a CSV, or type your expenses in. Kharcha sorts
            every transaction into a category and flags the ones that look unusual.
          </p>

          {data && (
            <div className="resume">
              <span>Your last analysis is still loaded ({data.rows} transactions).</span>
              <button className="btn" onClick={() => go("/results")}>
                Back to your results
              </button>
            </div>
          )}
          {session && (
            <div className="resume">
              <span>Signed in as {session.email}.</span>
              <button className="btn ghost" disabled={busy} onClick={loadSaved}>
                Open my saved expenses
              </button>
            </div>
          )}

          <div
            className={`drop${over ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) analyze(f);
            }}
          >
            <p className="drop-title">{busy ? "Reading your statement…" : "Drop a CSV here"}</p>
            <span>It needs date, description and amount columns.</span>
            <div className="drop-actions">
              <button className="btn" disabled={busy} onClick={() => fileRef.current.click()}>
                Choose a file
              </button>
              <button className="btn ghost" disabled={busy} onClick={useSample}>
                Use sample data
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => setManual(!manual)}>
                {manual ? "Hide manual entry" : "Enter expenses by hand"}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => e.target.files[0] && analyze(e.target.files[0])}
            />
            {busy && <div className="shimmer" aria-hidden="true" />}
            {slow && (
              <p className="note" role="status">
                The server is waking up. The first request can take up to a minute.
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <p className="note">
              Your file is read in memory to build this view. It is only saved if you sign in and choose
              Save to my account.
            </p>
          </div>
          {manual && <ManualEntry onAnalyze={analyze} busy={busy} />}
        </main>
      )}

      {view === "results" && data && (
        <main>
          <h1 className="headline">
            You spent <AnimatedAmount value={scopedTotal} />{" "}
            {month
              ? `in ${monthLabel(month)}.`
              : `over ${monthKeys.length} ${monthKeys.length === 1 ? "month" : "months"}.`}
          </h1>
          {cats[0] && scopedTotal > 0 && (
            <p className="lede">
              {cats[0][0]} took the largest share, at{" "}
              {Math.round((cats[0][1] / scopedTotal) * 100)}% of {month ? "that month" : "everything"}.
            </p>
          )}

          <div className="ribbon" role="group" aria-label="Spending by category">
            {order
              .filter((n) => catMap[n] > 0)
              .map((name) => {
                const amt = catMap[name];
                return (
                  <button
                    key={name}
                    className="seg"
                    style={{
                      flexGrow: amt,
                      background: CAT_COLORS[name] || "#5a6784",
                      opacity: lit && lit !== name ? 0.3 : 1,
                    }}
                    aria-pressed={activeCat === name}
                    aria-label={`${name}: ${inr(amt)}`}
                    title={`${name}: ${inr(amt)}`}
                    onClick={() => setCat(activeCat === name ? null : name)}
                    onMouseEnter={() => setHover(name)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(name)}
                    onBlur={() => setHover(null)}
                  />
                );
              })}
          </div>

          <ul className="legend">
            {cats.map(([name, amt]) => (
              <li key={name} style={{ opacity: lit && lit !== name ? 0.45 : 1 }}>
                <button
                  aria-pressed={activeCat === name}
                  onClick={() => setCat(activeCat === name ? null : name)}
                  onMouseEnter={() => setHover(name)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(name)}
                  onBlur={() => setHover(null)}
                >
                  <span className="dot" style={{ background: CAT_COLORS[name] || "#5a6784" }} />
                  <span>{name}</span>
                  <span className="num">{inr(amt)}</span>
                  <span className="pct">{Math.round((amt / scopedTotal) * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>

          {focus && (
            <p className="focus" role="status">
              {activeCat}: {focus.count} transactions, {inr(focus.avg)} on average, {inr(focus.max)} at most.
            </p>
          )}

          <MonthChart
            monthly={data.monthly_totals}
            forecast={data.forecast_next_month}
            month={month}
            onSelect={setMonth}
            dark={dark}
          />
          <Unusual items={data.anomalies} />

          <section className="section">
            <h2>Transactions</h2>
            <div className="tools">
              <input
                className="search"
                type="search"
                placeholder="Search descriptions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search transactions"
              />
              <select
                className="monthsel"
                value={month || ""}
                onChange={(e) => setMonth(e.target.value || null)}
                aria-label="Filter by month"
              >
                <option value="">All months</option>
                {monthKeys.map((k) => (
                  <option key={k} value={k}>
                    {monthLabel(k)}
                  </option>
                ))}
              </select>
              {activeCat && (
                <button className="chip" onClick={() => setCat(null)}>
                  Clear filter: {activeCat}
                </button>
              )}
              {editedCount > 0 && (
                <button className="chip" onClick={() => setOverrides({})}>
                  Undo category edits
                </button>
              )}
              {session ? (
                <button className="btn" disabled={saving} onClick={saveToAccount}>
                  {saving ? "Saving…" : "Save to my account"}
                </button>
              ) : (
                <button className="btn ghost" onClick={() => go("/account")}>
                  Sign in to save
                </button>
              )}
              <button className="btn ghost" onClick={exportCsv}>
                Download categorised CSV
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((t) => (
                    <tr key={t._i} {...flashProps(t)}>
                      <td>{fmtDate(t.date)}</td>
                      <td>
                        {t.description}
                        {t.is_anomaly && <span className="flag">Unusually high</span>}
                      </td>
                      <td>{catCell(t)}</td>
                      <td className="r">{inrExact(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="tx-list">
              {rows.slice(0, 100).map((t) => (
                <li key={t._i} {...flashProps(t)}>
                  <span className="tx-desc">
                    {t.description}
                    {t.is_anomaly && <span className="flag">Unusually high</span>}
                  </span>
                  <span className="tx-amt">{inrExact(t.amount)}</span>
                  <span className="tx-meta">
                    <span>{fmtDate(t.date)}</span>
                    {catCell(t)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="more">
              {rows.length > 100
                ? `Showing the first 100 of ${rows.length} transactions.`
                : `${rows.length} transactions.`}
            </p>
          </section>
        </main>
      )}

      {view === "settings" && (
        <Settings
          pref={pref}
          setPref={setPref}
          hasData={!!data}
          count={data ? data.rows : 0}
          editedCount={editedCount}
          onUndo={() => setOverrides({})}
          onExport={exportCsv}
          onClear={clearData}
          session={session}
          goSignIn={() => go("/account")}
          onSignOut={() => signOut()}
          onDeleteSaved={deleteSaved}
          onDeleteAccount={deleteAccount}
        />
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      <nav className="tabbar" aria-label="Main">
        <button aria-current={view === "home" ? "page" : undefined} onClick={() => go("/")}>
          <Home />
          <span>Home</span>
        </button>
        {data && (
          <button aria-current={view === "results" ? "page" : undefined} onClick={() => go("/results")}>
            <Chart />
            <span>Results</span>
          </button>
        )}
        <button
          aria-current={view === "settings" || view === "account" ? "page" : undefined}
          onClick={() => go("/settings")}
        >
          <Sliders />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}