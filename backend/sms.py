"""Turn bank SMS alerts into expense / credit rows.

Only the amount, date, payee, account digits and UPI reference are kept. The message
text itself is never stored, and balances are ignored.
Formats supported (seen in real messages): SBI UPI alerts and Canara Bank UPI alerts.
"""
import re
from datetime import datetime

import statement

# SBI:    Dear UPI user A/C X2050 debited by 120.00 on date 28Sep26 trf to NAME Refno 646822579564 ...
SBI = re.compile(
    r"A/C\s+X*(?P<acct>\d{3,6})\s+(?P<dir>debited|credited)\s+by\s+(?P<amt>[\d,]+(?:\.\d+)?)\s+"
    r"on\s+date\s+(?P<date>\d{2}[A-Za-z]{3}\d{2})\s+trf\s+(?:to|from)\s+(?P<name>.+?)\s+Refno\s+(?P<ref>\d+)",
    re.I,
)
# Canara: Acct XXX569 Dr. INR 35,000.00 on 07/10/26 to NAME; UPI: 518833506622; Bal INR ...
#         Acct XXX569 credited with INR 12,000.00 on 10/10/26 from NAME; UPI:311275046483; Bal ...
CANARA = re.compile(
    r"Acct\s+X*(?P<acct>\d{3,6})\s+(?:(?P<dr>Dr\.)|(?P<cr>credited\s+with))\s+INR\s+(?P<amt>[\d,]+(?:\.\d+)?)\s+"
    r"on\s+(?P<date>\d{2}/\d{2}/\d{2})\s+(?:to|from)\s+(?P<name>.+?);\s*UPI:\s*(?P<ref>\d+)",
    re.I,
)
# Reminders about a future autopay are not payments yet.
NOT_A_PAYMENT = re.compile(r"mandate|is scheduled|will be debited|upcoming", re.I)

MAX_MESSAGES = 2000
MAX_BODY = 600


def _clean(x: str) -> str:
    return re.sub(r"\s+", " ", x).strip()


def parse_message(body: str):
    """Return a dict for a payment message, 'skip' for a known non-payment, or None if unrecognised."""
    body = _clean(body)[:MAX_BODY]
    if NOT_A_PAYMENT.search(body):
        return "skip"
    m = SBI.search(body)
    if m:
        kind = "expense" if m.group("dir").lower() == "debited" else "credit"
        date_fmt = "%d%b%y"
    else:
        m = CANARA.search(body)
        if not m:
            return None
        kind = "expense" if m.group("dr") else "credit"
        date_fmt = "%d/%m/%y"
    try:
        date = datetime.strptime(m.group("date"), date_fmt).strftime("%Y-%m-%d")
        amount = float(m.group("amt").replace(",", ""))
    except ValueError:
        return None
    if amount <= 0 or amount > 1e9:
        return None
    return {
        "date": date,
        "name": _clean(m.group("name")),
        "amount": amount,
        "kind": kind,
        "account": m.group("acct"),
        "ref": m.group("ref"),
    }


def parse_messages(messages, predict=None) -> dict:
    """messages: list of {'body': str}. Returns the same shape as statement.parse()."""
    expenses, credits = [], []
    parsed = ignored = own = 0
    for msg in messages[:MAX_MESSAGES]:
        r = parse_message(str(msg.get("body", "")))
        if r is None:
            ignored += 1
            continue
        if r == "skip":
            continue
        if statement.OWN_ACCOUNT.match(r["name"]):
            own += 1
            continue
        parsed += 1
        row = {
            "date": r["date"],
            "description": r["name"][:300],
            "payee": statement.payee_key(r["name"]),
            "amount": r["amount"],
            "kind": r["kind"],
            "account": r["account"],
            "ref": r["ref"],
        }
        if r["kind"] == "credit":
            row.update(category="Credited", source="credit")
            credits.append(row)
        else:
            cat, source = statement.categorize(r["name"], r["amount"])
            row.update(category=cat, source=source)
            expenses.append(row)
    statement.fill_unknown(expenses, predict)
    return {
        "expenses": expenses,
        "credits": credits,
        "skipped": {"own_transfers": own, "refunded": 0},
        "found": parsed,
        "expected": parsed,
        "ignored": ignored,
    }