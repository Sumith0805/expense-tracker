"""Read a PhonePe transaction statement (PDF) and turn it into expense / credit rows.

The PDF is read in memory and never stored. Only date, payee, amount, category,
account (last 4 digits) and the UTR reference are kept.
"""
import re
from datetime import datetime
from io import BytesIO

from pypdf import PdfReader

BLOCK = re.compile(
    r"(?P<date>[A-Z][a-z]{2} \d{2}, \d{4})\s+(?P<time>\d{2}:\d{2} [AP]M)\s+"
    r"(?P<detail>(?:Paid to|Received from)\s+.+?)\s+Transaction ID\s*:\s*(?P<tid>\S+)\s+"
    r"(?P<type>Debit|Credit)\s+INR\s+(?P<amt>[\d,]+\.\d{2})\s+"
    r"UTR No\s*:\s*(?P<utr>\d+)\s+(?P<dir>Debited from|Credited to)\s+(?P<acct>\S+)",
    re.S,
)
OWN_ACCOUNT = re.compile(r"^X{2,4}\d{4}$", re.I)
BUSINESS_WORDS = re.compile(
    r"limited|\bltd\b|\bpvt\b|private|technolog|services|traders|enterprises|"
    r"\bshop\b|\bstall\b|centre|center|\bpoint\b|\bstore\b|agency",
    re.I,
)
MASKED = re.compile(r"^\*+\d{3,4}$")
BIG_TRANSFER = 5000.0

# First match wins, so the specific rules come before the general ones.
RULES = [
    ("Investments", r"jar gold|zerodha|indstocks|groww|upstox|mutual fund|\bcoin"),
    ("Loans / EMI", r"credila|\bemi\b|\bloan\b|bajaj fin|finserv|\bfinance\b"),
    ("Groceries", r"amazon pay groceries|kiranam|kirana|general store|supermarket|vegetable|"
                  r"bigbasket|blinkit|zepto|dmart|ratnadeep|\bmore\b|\bmilk\b|dairy"),
    ("Transport", r"\bcng\b|petrol|fuel|hpcl|bpcl|indian oil|metro|apsrtc|tsrtc|state road transport|"
                  r"\brtc\b|\buber\b|\bola\b|rapido|irctc|redbus|transport|parking|fastag"),
    ("Food", r"zomato|swiggy|\bkfc\b|dhaba|tiffin|\btea\b|juice|restaurant|\bhotel\b|cafe|bakery|"
             r"biryani|pizza|domino|mcdonald|\bbar\b"),
    ("Health", r"apollo|hospital|medical|pharmacy|clinic|diagnostic|\bdr\b|medplus"),
    ("Education", r"\bbooks?\b|school|college|tuition|udemy|coaching|stationery"),
    ("Entertainment", r"netflix|hotstar|spotify|bookmyshow|prime video|\bpvr\b|\binox\b"),
    ("Bills", r"recharge|airtel|\bjio\b|vodafone|\bbsnl\b|electricity|tsspdcl|broadband|insurance|\blic\b"),
    ("Shopping", r"amazon|flipkart|myntra|zudio|mobiles?\b|emporium|fashion|\bmall\b|meesho|ajio|trends"),
]
RULES = [(cat, re.compile(rx, re.I)) for cat, rx in RULES]


class StatementError(Exception):
    """Raised with a message that is safe to show to the user."""


def pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise StatementError("This PDF is password protected. Remove the password and try again.")
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except StatementError:
        raise
    except Exception:
        raise StatementError("Could not read that PDF. Download the statement again and retry.")


def _clean(x: str) -> str:
    return re.sub(r"\s+", " ", x).strip()


def payee_key(name: str) -> str:
    """Stable key used to remember a category for a payee."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()[:120]


def looks_like_person(name: str) -> bool:
    if BUSINESS_WORDS.search(name):
        return False
    tokens = name.split()
    return 1 <= len(tokens) <= 4 and all(re.fullmatch(r"[A-Za-z.]+", t) for t in tokens)


def categorize(name: str, amount: float):
    """Return (category, source). source is 'rule', 'person' or 'none' (needs the model)."""
    for cat, rx in RULES:
        if rx.search(name):
            return cat, "rule"
    if MASKED.match(name) or looks_like_person(name):
        return ("Transfers" if amount >= BIG_TRANSFER else "Contacts"), "person"
    return None, "none"


def parse(data: bytes, predict=None) -> dict:
    """predict: optional function(list_of_descriptions) -> list_of_categories for unknown merchants."""
    text = pdf_text(data)
    expected = text.count("Transaction ID")
    records = []
    for m in BLOCK.finditer(text):
        detail = _clean(m.group("detail"))
        name = re.sub(r"^(Paid to|Received from)\s+", "", detail)
        digits = re.search(r"(\d{4})$", m.group("acct"))
        records.append(
            {
                "date": datetime.strptime(m.group("date"), "%b %d, %Y").strftime("%Y-%m-%d"),
                "name": name,
                "amount": float(m.group("amt").replace(",", "")),
                "kind": "expense" if m.group("type") == "Debit" else "credit",
                "account": digits.group(1) if digits else "",
                "ref": m.group("utr"),
            }
        )

    # A refund shows up as a debit and a credit with the same reference: they cancel out.
    by_ref = {}
    for r in records:
        by_ref.setdefault(r["ref"], set()).add(r["kind"])
    refunded_refs = {ref for ref, kinds in by_ref.items() if kinds == {"expense", "credit"}}

    skipped = {"own_transfers": 0, "refunded": 0}
    expenses, credits = [], []
    for r in records:
        if r["ref"] in refunded_refs:
            skipped["refunded"] += 1
            continue
        if OWN_ACCOUNT.match(r["name"]):
            skipped["own_transfers"] += 1
            continue
        row = {
            "date": r["date"],
            "description": r["name"][:300],
            "payee": payee_key(r["name"]),
            "amount": r["amount"],
            "kind": r["kind"],
            "account": r["account"],
            "ref": r["ref"],
        }
        if r["kind"] == "credit":
            row.update(category="Credited", source="credit")
            credits.append(row)
        else:
            cat, source = categorize(r["name"], r["amount"])
            row.update(category=cat, source=source)
            expenses.append(row)

    unknown = [e for e in expenses if e["category"] is None]
    if unknown:
        guesses = []
        if predict is not None:
            try:
                guesses = list(predict([e["description"].lower() for e in unknown]))
            except Exception:
                guesses = []
        for i, e in enumerate(unknown):
            e["category"] = str(guesses[i]) if i < len(guesses) else "Other"
            e["source"] = "model" if i < len(guesses) else "none"

    return {
        "expenses": expenses,
        "credits": credits,
        "skipped": skipped,
        "found": len(records),
        "expected": expected,
    }