// Reads bank / UPI / card alerts from SMS text. Runs on the phone, so it works offline and the
// message text never has to leave the device. Only the parsed fields are ever uploaded.
//
// Banks word their alerts differently, so this looks for the common building blocks
// (amount, debit/credit word, account digits, reference, who it was to/from, date)
// instead of one fixed layout per bank. Anything it cannot read is counted, never guessed.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// ---------- categories (same rules as the server) ----------
const RULES = [
  ["Other", /\batm\b|cash withdrawal/i],
  ["Investments", /jar gold|zerodha|indstocks|groww|upstox|mutual fund|\bcoin/i],
  ["Loans / EMI", /credila|\bemi\b|\bloan\b|bajaj fin|finserv|\bfinance\b/i],
  [
    "Groceries",
    /amazon pay groceries|kiranam|kirana|general store|supermarket|vegetable|bigbasket|blinkit|zepto|dmart|ratnadeep|\bmore\b|\bmilk\b|dairy/i,
  ],
  [
    "Transport",
    /\bcng\b|petrol|fuel|hpcl|bpcl|indian oil|metro|apsrtc|tsrtc|state road transport|\brtc\b|\buber\b|\bola\b|rapido|irctc|redbus|transport|parking|fastag/i,
  ],
  ["Food", /zomato|swiggy|\bkfc\b|dhaba|tiffin|\btea\b|juice|restaurant|\bhotel\b|cafe|bakery|biryani|pizza|domino|mcdonald|\bbar\b/i],
  ["Health", /apollo|hospital|medical|pharmacy|clinic|diagnostic|\bdr\b|medplus/i],
  ["Education", /\bbooks?\b|school|college|tuition|udemy|coaching|stationery/i],
  ["Entertainment", /netflix|hotstar|spotify|bookmyshow|prime video|\bpvr\b|\binox\b/i],
  ["Bills", /recharge|airtel|\bjio\b|vodafone|\bbsnl\b|electricity|tsspdcl|broadband|insurance|\blic\b/i],
  ["Shopping", /amazon|flipkart|myntra|zudio|mobiles?\b|emporium|fashion|\bmall\b|meesho|ajio|trends/i],
];
const OWN_ACCOUNT = /^X{2,4}\d{4}$/i;
const MASKED = /^\*+\d{3,4}$/;
const BUSINESS_WORDS =
  /limited|\bltd\b|\bpvt\b|private|technolog|services|traders|enterprises|\bshop\b|\bstall\b|centre|center|\bpoint\b|\bstore\b|agency/i;
const BIG_TRANSFER = 5000;

export function payeeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

function looksLikePerson(name) {
  if (BUSINESS_WORDS.test(name)) return false;
  const tokens = name.split(/\s+/).filter(Boolean);
  return tokens.length >= 1 && tokens.length <= 4 && tokens.every((t) => /^[A-Za-z.]+$/.test(t));
}

export function categorize(name, amount) {
  for (const [cat, rx] of RULES) if (rx.test(name)) return [cat, "rule"];
  if (MASKED.test(name) || looksLikePerson(name)) return [amount >= BIG_TRANSFER ? "Transfers" : "Contacts", "person"];
  return ["Other", "none"];
}

// ---------- building blocks ----------
const CURRENCY = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const VERB_AMOUNT =
  /\b(?:debited|credited|withdrawn|deposited|spent|paid|sent|received|transferred)\s+(?:by|for|of|with)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|[\d,]{2,})\b/gi;
const BALANCE_CONTEXT = /\b(bal|balance|avl|avail\w*|limit|outstanding|due|min|minimum|charges?|fee)\b/i;

const DEBIT_WORDS = /\b(debited|withdrawn|withdrawal|spent|paid|sent|purchase[d]?|used for|transferred(?!\s+(?:to\s+your|into)))\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|reversed|transferred\s+(?:to\s+your|into))\b/i;
const DR_CR = /\b(dr|cr)\.?(?=\s*(?:inr|rs\.?|₹|\d))/i;

// Messages that look like money but are not a completed payment.
const NOT_A_PAYMENT =
  /\b(mandate|auto[- ]?pay|scheduled|will be debited|to be debited|will be credited|due (?:on|date|by)|minimum amount due|min(?:imum)? due|statement|bill (?:is )?(?:generated|due)|payment request|collect request|requested|declined|failed|unsuccessful|not successful|insufficient|reminder|offer|apply now|click|http|bit\.ly|congratulations|win\b)/i;
const OTP = /\b(otp|one[- ]time password|verification code|passcode)\b/i;
const CARD_BILL_PAYMENT = /credit card/i;

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function pickAmount(text) {
  const found = [];
  for (const rx of [CURRENCY, VERB_AMOUNT]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (BALANCE_CONTEXT.test(before)) continue;
      const amount = parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0 && amount <= 1e9) found.push({ at: m.index, amount });
    }
  }
  found.sort((a, b) => a.at - b.at);
  return found.length ? found[0].amount : null;
}

function pickDirection(text) {
  const spots = [];
  const d = DEBIT_WORDS.exec(text);
  if (d) spots.push({ at: d.index, kind: "expense" });
  const c = CREDIT_WORDS.exec(text);
  if (c) spots.push({ at: c.index, kind: "credit" });
  const dc = DR_CR.exec(text);
  if (dc) spots.push({ at: dc.index, kind: dc[1].toLowerCase() === "dr" ? "expense" : "credit" });
  if (spots.length) {
    spots.sort((a, b) => a.at - b.at);
    return spots[0].kind; // the first verb is about your own account
  }
  if (/\bcard\b/i.test(text) && /\b(txn|transaction|purchase|spent|used)\b/i.test(text)) return "expense";
  return null;
}

function pickAccount(text) {
  const acct = /(?:a\/c|\bac\b|acct?|account)\.?\s*(?:no\.?|number|ending(?: with)?)?\s*[:.\-]?\s*(?:[xX*]+\s*)?(\d{3,6})\b/i.exec(text);
  const card = /card\s*(?:no\.?|ending(?: with)?)?\s*[:.\-]?\s*(?:[xX*]+\s*)?(\d{4})\b/i.exec(text);
  const m = acct || card;
  return m ? m[1].slice(-4) : "";
}

function pickRef(text) {
  const a = /(?:ref(?:erence)?|refno|rrn|utr|upi|txn|transaction)[\s.:#\-]*(?:no\.?|number|id)?[\s.:#\-]*(\d{9,16})\b/i.exec(text);
  if (a) return a[1];
  const b = /\bUPI[\/\-](?:[A-Za-z0-9]+[\/\-])*?(\d{12})\b/.exec(text);
  return b ? b[1] : "";
}

function pickDate(text, fallbackMs) {
  const fallback = new Date(fallbackMs || Date.now());
  const iso = (y, m, d) => {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    // an alert cannot be about a date after it was sent
    if (fallbackMs && dt.getTime() > fallbackMs + 2 * 86400000) return null;
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const year = (s) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  let m = /\b(\d{1,2})[-\/ .]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\/ .,]*(\d{2,4})\b/i.exec(text);
  if (m) {
    const r = iso(year(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    if (r) return r;
  }
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) {
    const r = iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (r) return r;
  }
  m = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/.exec(text);
  if (m) {
    const r = iso(year(m[3]), Number(m[2]) - 1, Number(m[1])); // day first, as banks in India write it
    if (r) return r;
  }
  return iso(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

const NAME = "([A-Za-z0-9@._&'()\\- ]{2,60}?)";
const STOP =
  "(?=\\s*(?:\\bon\\b|\\bat\\b|\\bdated?\\b|\\bref\\b|\\bupi\\b|\\brefno\\b|\\brrn\\b|\\binfo\\b|\\bavl\\b|\\bbal\\b|\\bbalance\\b|\\btotal\\b|\\bif\\b|\\bnot\\b|\\bcall\\b|\\bsms\\b|\\bplease\\b|\\bthru\\b|\\bvia\\b|\\bthrough\\b|\\bfrom\\b|\\busing\\b|\\blinked\\b|\\bcredited\\b|\\bdebited\\b|[;,]|\\.\\s|\\.$|\\(|\\s-\\s|$))";
const NOT_A_NAME = /^(a\/c|acc|acct|account|your|my|card|xx|x+\d|wallet|bank|self|neft|imps|rtgs|upi|transfer|cheque|cash|clearing)\b/i;

function cleanName(raw) {
  let n = clean(raw).replace(/^VPA\s+/i, "");
  if (n.includes("@")) n = n.split("@")[0];
  n = n.replace(/[-_.]+$/, "").trim();
  return n;
}

function pickName(text, kind) {
  const tries =
    kind === "expense"
      ? [
          new RegExp("\\b(?:trf\\s+to|transferred\\s+to|sent\\s+to|paid\\s+to|payment\\s+to|to\\s+VPA|to)\\s+" + NAME + STOP, "gi"),
          new RegExp("[;,]\\s*" + NAME + "\\s+credited\\b", "gi"),
          new RegExp("\\b(?:at|towards)\\s+" + NAME + STOP, "gi"),
        ]
      : [
          new RegExp("\\b(?:trf\\s+from|transfer(?:red)?\\s+from|received\\s+from|from\\s+VPA|from)\\s+" + NAME + STOP, "gi"),
          new RegExp("\\bby\\s+" + NAME + STOP, "gi"),
        ];
  for (const rx of tries) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const n = cleanName(m[1]);
      if (n.length >= 2 && !NOT_A_NAME.test(n) && !/^\d{5,}/.test(n) && !/^[\d\s]+$/.test(n)) return n;
    }
  }
  // Layout like UPI/P2M/123456789012/NAME
  const slash = /\bUPI[\/\-](?:[A-Za-z0-9]+[\/\-])*?\d{9,16}[\/\-]([A-Za-z0-9 .&'_]{2,40}?)(?=[\/\s]|$)/.exec(text);
  if (slash) return cleanName(slash[1]);
  const info = /\binfo[:\-]\s*([^.]+)/i.exec(text);
  if (info) {
    const part = info[1]
      .split(/[\/|]/)
      .map((p) => p.trim())
      .find((p) => /[A-Za-z]{3,}/.test(p) && !/^(upi|cr|dr|p2a|p2m|imps|neft|rtgs|ref|payment)$/i.test(p));
    if (part) return cleanName(part);
  }
  if (/\batm\b|cash withdrawal/i.test(text)) return "ATM cash withdrawal";
  return kind === "credit" ? "Money received" : "Payment";
}

// Parse one message. Returns { type: "txn" | "ignore" | "unknown", ... }
export function parseSms(body, sender, ts) {
  const text = clean(body);
  if (!text) return { type: "ignore" };
  if (sender && /^\+?\d[\d\s-]{6,}$/.test(String(sender).trim())) return { type: "ignore" }; // a person, not a bank
  if (NOT_A_PAYMENT.test(text)) return { type: "ignore" };

  const kind = pickDirection(text);
  const amount = pickAmount(text);
  if (!kind) return { type: OTP.test(text) ? "ignore" : amount ? "unknown" : "ignore" };
  if (amount == null) return { type: "unknown" };
  if (kind === "credit" && CARD_BILL_PAYMENT.test(text)) return { type: "ignore" }; // card bill payments are not income

  const name = pickName(text, kind);
  const ref = pickRef(text);
  return {
    type: "txn",
    kind,
    amount,
    name,
    named: !["Payment", "Money received", "ATM cash withdrawal"].includes(name),
    account: pickAccount(text),
    // Messages without a reference get one made from the time they arrived, so reading
    // the same inbox again never counts a payment twice.
    ref: ref || `m${ts || Math.round(amount * 100)}-${Math.round(amount)}`.slice(0, 32),
    date: pickDate(text, ts),
  };
}

// Hide long numbers (references, phone numbers) before a message is copied to be reported.
export function maskForReport(text) {
  return clean(text).replace(/\d{8,}/g, (d) => "9".repeat(d.length));
}

// Parse a list of { sender, body, date } messages into rows ready for the app.
export function parseSmsBatch(messages) {
  const spend = [];
  const credits = [];
  const unknown = [];
  let ignored = 0;
  let own = 0;
  for (const msg of messages || []) {
    const r = parseSms(msg.body, msg.sender, msg.date);
    if (r.type === "ignore") {
      ignored += 1;
      continue;
    }
    if (r.type === "unknown") {
      if (unknown.length < 30) unknown.push(maskForReport(msg.body));
      continue;
    }
    if (OWN_ACCOUNT.test(r.name)) {
      own += 1;
      continue;
    }
    const row = {
      date: r.date,
      description: r.name.slice(0, 300),
      payee: payeeKey(r.name),
      amount: r.amount,
      account: r.account,
      ref: r.ref,
    };
    if (r.kind === "credit") {
      credits.push({ ...row, category: "Credited", kind: "credit", source: "credit" });
    } else {
      const [category, source] = r.named ? categorize(r.name, r.amount) : ["Other", "none"];
      spend.push({ ...row, category, kind: "expense", source });
    }
  }
  return { spend, credits, unknown, ignored, own };
}