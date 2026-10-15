// Offline support: a copy of your saved data on the phone, plus payments read from SMS that
// have not been uploaded yet. The dashboard numbers are worked out here, so they show without
// internet. Used only inside the Android app.

const KEY = "kharcha-offline-v1";
const REVIEW = new Set(["person", "none", "model"]);

export const emptyStore = () => ({
  server: { spend: [], credits: [] }, // last copy of what is saved in your account
  pending: { spend: [], credits: [] }, // read from SMS, not uploaded yet
  unread: [], // messages that could not be read (long numbers hidden)
  serverLoaded: false, // true once a copy of the saved data has been downloaded at least once
  updatedAt: 0,
});

export function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.server && s.pending) return { ...emptyStore(), ...s };
  } catch {
    /* nothing stored yet */
  }
  return emptyStore();
}

export function saveStore(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...store, updatedAt: Date.now() }));
    return true;
  } catch {
    return false; // storage full or unavailable: the app still works for this session
  }
}

export function clearStore() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const rowKey = (r) =>
  r.ref ? `${r.kind}|${r.ref}` : `${r.kind}|${r.date}|${r.description}|${r.amount}`;

const tag = (rows, kind) => rows.map((r) => ({ ...r, kind }));

export function pendingCount(store) {
  return store.pending.spend.length + store.pending.credits.length;
}

export function hasData(store) {
  return (
    store.server.spend.length + store.server.credits.length + pendingCount(store) > 0
  );
}

// Put a fresh copy of the saved data from the server in the store.
export function setServerRows(store, spend, credits) {
  const server = { spend: tag(spend, "expense"), credits: tag(credits, "credit") };
  const have = new Set([...server.spend, ...server.credits].map(rowKey));
  const keep = (rows) => rows.filter((r) => !have.has(rowKey(r)));
  return {
    ...store,
    server,
    serverLoaded: true,
    pending: { spend: keep(store.pending.spend), credits: keep(store.pending.credits) },
  };
}

// Same, but category changes made on this phone that are not saved yet are kept.
export function mergeServer(store, spend, credits) {
  const edited = new Map(
    store.server.spend.filter((r) => r.source === "user").map((r) => [rowKey({ ...r, kind: "expense" }), r])
  );
  const merged = spend.map((r) => {
    const e = edited.get(rowKey({ ...r, kind: "expense" }));
    return e ? { ...r, category: e.category, source: "user" } : r;
  });
  return setServerRows(store, merged, credits);
}

// Change one payment's category on the phone (works offline).
export function editCategory(store, row, category) {
  const k = rowKey({ ...row, kind: "expense" });
  const edit = (rows) =>
    rows.map((r) =>
      rowKey({ ...r, kind: "expense" }) === k
        ? {
            ...r,
            category,
            was: r.was !== undefined ? r.was : r.category, // so an undo can put it back
            wasSource: r.was !== undefined ? r.wasSource : r.source || "",
            source: "user",
          }
        : r
    );
  return {
    ...store,
    server: { ...store.server, spend: edit(store.server.spend) },
    pending: { ...store.pending, spend: edit(store.pending.spend) },
  };
}

// Add payments read from SMS. Anything already known (saved or waiting) is skipped.
export function addPending(store, spend, credits) {
  const seen = new Set(
    [...store.server.spend, ...store.server.credits, ...store.pending.spend, ...store.pending.credits].map(rowKey)
  );
  let duplicates = 0;
  const take = (rows, kind) => {
    const out = [];
    for (const r of rows) {
      const row = { ...r, kind };
      const k = rowKey(row);
      if (seen.has(k)) {
        duplicates += 1;
        continue;
      }
      seen.add(k);
      out.push(row);
    }
    return out;
  };
  const s = take(spend, "expense");
  const c = take(credits, "credit");
  return {
    store: { ...store, pending: { spend: [...store.pending.spend, ...s], credits: [...store.pending.credits, ...c] } },
    addedRows: [...s, ...c],
    added: s.length,
    creditsAdded: c.length,
    duplicates,
  };
}

// Put a payment's category back to what it was before it was edited on this phone.
export function revertCategory(store, row) {
  const k = rowKey({ ...row, kind: "expense" });
  const undo = (rows) =>
    rows.map((r) => {
      if (rowKey({ ...r, kind: "expense" }) !== k || r.was === undefined) return r;
      const { was, wasSource, ...rest } = r;
      return { ...rest, category: was, source: wasSource || "" };
    });
  return {
    ...store,
    server: { ...store.server, spend: undo(store.server.spend) },
    pending: { ...store.pending, spend: undo(store.pending.spend) },
  };
}

export function addUnread(store, texts) {
  const merged = [...new Set([...(texts || []), ...store.unread])].slice(0, 30);
  return { ...store, unread: merged };
}

// What you chose before for each payee (from your saved data), so new payments to them match.
export function learnedCategories(store) {
  const votes = {};
  for (const r of store.server.spend) {
    if (!r.payee) continue;
    votes[r.payee] = votes[r.payee] || {};
    votes[r.payee][r.category] = (votes[r.payee][r.category] || 0) + 1;
  }
  const out = {};
  for (const [payee, counts] of Object.entries(votes)) {
    out[payee] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

export function applyMemory(rows, memory) {
  return rows.map((r) => (memory[r.payee] ? { ...r, category: memory[r.payee], source: "memory" } : r));
}

// Bank SMS often shows 3 digits of an account where statements show 4. Treat them as one account
// when exactly one longer account ends with the same digits.
export function normalizeAccounts(rows) {
  const known = [...new Set(rows.map((r) => r.account || "").filter((a) => a.length >= 4))];
  return rows.map((r) => {
    const a = r.account || "";
    if (a && a.length < 4) {
      const m = known.filter((k) => k.endsWith(a));
      if (m.length === 1) return { ...r, account: m[0] };
    }
    return r;
  });
}

const round2 = (n) => Math.round(n * 100) / 100;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function forecast(monthly) {
  const totals = Object.values(monthly);
  if (totals.length < 2) return null;
  const y = totals.slice(-6);
  const n = y.length;
  const xm = (n - 1) / 2;
  const ym = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  y.forEach((v, i) => {
    num += (i - xm) * (v - ym);
    den += (i - xm) ** 2;
  });
  const slope = num / den;
  const intercept = ym - slope * xm;
  return round2(Math.max(0, slope * n + intercept));
}

// Same shape the server sends, so every screen works unchanged.
// Note: "unusual spends" uses a simple rule here (the biggest ~3% in each category with 20 or more
// payments) instead of the server's statistical model.
export function buildLocalData(store) {
  const all = [...tag(store.server.spend, "expense"), ...tag(store.pending.spend, "expense")];
  const allCredits = [...tag(store.server.credits, "credit"), ...tag(store.pending.credits, "credit")];
  const norm = normalizeAccounts([...all, ...allCredits]);
  const spend = norm.slice(0, all.length).sort(byDate);
  const credits = norm.slice(all.length).sort(byDate);

  const flagged = new Set();
  const groups = {};
  spend.forEach((r, i) => {
    (groups[r.category] = groups[r.category] || []).push(i);
  });
  for (const idx of Object.values(groups)) {
    const n = idx.length;
    if (n < 20) continue;
    const amounts = idx.map((i) => spend[i].amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(n / 2)];
    const k = Math.ceil((n - 1) * 0.03);
    [...idx]
      .sort((a, b) => spend[b].amount - spend[a].amount)
      .slice(0, k)
      .forEach((i) => {
        if (spend[i].amount > median) flagged.add(i);
      });
  }

  const transactions = spend.map((r, i) => ({
    date: r.date,
    description: r.description,
    amount: r.amount,
    category: r.category,
    payee: r.payee || "",
    account: r.account || "",
    ref: r.ref || "",
    source: r.source || "",
    needs_review: REVIEW.has(r.source || ""),
    is_anomaly: flagged.has(i),
  }));

  const monthly = {};
  const byCat = {};
  let total = 0;
  for (const t of transactions) {
    const m = t.date.slice(0, 7);
    monthly[m] = (monthly[m] || 0) + t.amount;
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    total += t.amount;
  }
  const monthly_totals = Object.fromEntries(Object.keys(monthly).sort().map((m) => [m, round2(monthly[m])]));
  const by_category = Object.fromEntries(
    Object.entries(byCat)
      .map(([c, v]) => [c, round2(v)])
      .sort((a, b) => b[1] - a[1])
  );

  return {
    local: true, // built on the phone from its own copy of the data
    rows: transactions.length,
    total_spent: round2(total),
    by_category,
    monthly_totals,
    forecast_next_month: forecast(monthly_totals),
    anomalies: transactions.filter((t) => t.is_anomaly),
    transactions,
    credits: credits.map((r) => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      category: "Credited",
      payee: r.payee || "",
      account: r.account || "",
      ref: r.ref || "",
      kind: "credit",
    })),
  };
}