"""Shared pieces for building the dashboard response from saved or imported rows."""
import pandas as pd

from analytics import build_response

CATEGORIES = {
    "Food", "Groceries", "Transport", "Shopping", "Bills",
    "Entertainment", "Health", "Education", "Transfers",
    "Investments", "Loans / EMI", "Contacts", "Other",
}
CREDIT_CATEGORY = "Credited"

COLUMNS = ["date", "description", "amount", "category", "payee", "account", "ref", "source"]
# Rows whose category was only a guess are shown with a "check" mark until the user edits them.
REVIEW_SOURCES = {"person", "none", "model"}


def expense_frame(rows):
    df = pd.DataFrame(list(rows), columns=COLUMNS) if rows else pd.DataFrame(columns=COLUMNS)
    for col in ("date", "description", "category", "payee", "account", "ref", "source"):
        df[col] = df[col].fillna("").astype(str)
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0.0).astype(float)
    df["needs_review"] = df["source"].isin(REVIEW_SOURCES)
    return df.sort_values("date", kind="stable").reset_index(drop=True)


def credit_rows(rows):
    return [
        {
            "date": r["date"],
            "description": r["description"],
            "amount": r["amount"],
            "category": CREDIT_CATEGORY,
            "payee": r.get("payee", ""),
            "account": r.get("account", ""),
            "ref": r.get("ref", ""),
            "kind": "credit",
        }
        for r in sorted(rows, key=lambda r: r["date"])
    ]


def normalize_accounts(*groups):
    """Bank SMS often shows 3 digits of an account (569) where statements show 4 (6569).
    When exactly one longer account ends with those digits, treat them as the same account."""
    rows = [r for g in groups for r in g]
    known = {r.get("account", "") for r in rows if len(r.get("account", "")) >= 4}
    for r in rows:
        acct = r.get("account", "")
        if acct and len(acct) < 4:
            matches = [k for k in known if k.endswith(acct)]
            if len(matches) == 1:
                r["account"] = matches[0]


def full_response(expenses, credits):
    """Same shape as the CSV analysis, plus a separate list of money received."""
    normalize_accounts(expenses, credits)
    resp = build_response(expense_frame(expenses))
    resp["credits"] = credit_rows(credits)
    return resp