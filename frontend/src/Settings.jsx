import { useState } from "react";

const OPTIONS = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

export default function Settings({
  pref,
  setPref,
  hasData,
  count,
  editedCount,
  onUndo,
  onExport,
  onClear,
  session,
  goSignIn,
  onSignOut,
  onDeleteSaved,
  onDeleteAccount,
}) {
  const [ask, setAsk] = useState(null);

  const confirmRow = (key, label, yes, run) =>
    ask === key ? (
      <>
        <button
          className="btn danger"
          onClick={() => {
            run();
            setAsk(null);
          }}
        >
          {yes}
        </button>
        <button className="btn ghost" onClick={() => setAsk(null)}>
          Keep it
        </button>
      </>
    ) : (
      <button className="btn ghost" onClick={() => setAsk(key)}>
        {label}
      </button>
    );

  return (
    <main>
      <h1 className="headline small">Settings</h1>

      <section className="set">
        <h2>Appearance</h2>
        <div className="seg-ctl" role="radiogroup" aria-label="Colour mode">
          {OPTIONS.map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={pref === value}
              className={pref === value ? "on" : ""}
              onClick={() => setPref(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="sub">
          System follows your phone or computer. Animations follow it too: if your device is set to
          reduce motion, Kharcha keeps things still.
        </p>
      </section>

      <section className="set">
        <h2>Your data</h2>
        {hasData ? (
          <>
            <p className="sub">
              {count} transactions are loaded in this browser tab. They are only stored on your account if
              you sign in and choose Save to my account.
            </p>
            <div className="set-actions">
              <button className="btn ghost" onClick={onExport}>
                Download categorised CSV
              </button>
              {editedCount > 0 && (
                <button className="btn ghost" onClick={onUndo}>
                  Undo {editedCount} category {editedCount === 1 ? "edit" : "edits"}
                </button>
              )}
              {confirmRow("clear", "Clear loaded data", "Yes, clear it", onClear)}
            </div>
          </>
        ) : (
          <p className="sub">Nothing is loaded. Upload a statement or type in expenses from the home page.</p>
        )}
      </section>

      <section className="set">
        <h2>Account</h2>
        {session ? (
          <>
            <p className="sub">
              Signed in as <strong>{session.email}</strong>.
            </p>
            <div className="set-actions">
              <button className="btn ghost" onClick={onSignOut}>
                Sign out
              </button>
              {confirmRow(
                "saved",
                "Delete my saved expenses",
                "Yes, delete saved expenses",
                onDeleteSaved
              )}
              {confirmRow(
                "acct",
                "Delete my account",
                "Yes, delete my account",
                onDeleteAccount
              )}
            </div>
            <p className="sub">
              Deleting your account removes your email, your password hash and every saved expense. This
              can't be undone.
            </p>
          </>
        ) : (
          <>
            <p className="sub">
              You are not signed in. An account lets you save your expenses and open them again later.
            </p>
            <div className="set-actions">
              <button className="btn" onClick={goSignIn}>
                Sign in or register
              </button>
            </div>
          </>
        )}
      </section>

      <section className="set">
        <h2>Privacy</h2>
        <p className="sub">
          Files are read in memory to build your view. Only expenses you choose to save are stored, and
          only on your account. This is a portfolio demo, so the sample data is the safest way to try it.
        </p>
      </section>
    </main>
  );
}