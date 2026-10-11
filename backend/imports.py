"""Add statement PDFs to the current list of transactions."""
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import joblib
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import statement
from auth import bearer, current_user
from db import Expense, User, get_db
from ledger import CATEGORIES, CREDIT_CATEGORY, REVIEW_SOURCES, full_response

router = APIRouter(prefix="/import", tags=["import"])

MAX_FILES = 5
MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 5000
MODEL_PATH = Path(__file__).with_name("model.joblib")
_model = None


def predict(descriptions):
    """The existing category model, used only for merchants no rule recognises."""
    global _model
    if _model is None:
        _model = joblib.load(MODEL_PATH)
    return _model.predict(descriptions)


def optional_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Signed-in users get their saved categories applied. Everyone else can still import."""
    if creds is None:
        return None
    try:
        return current_user(creds, db)
    except HTTPException:
        return None


def clean_row(x, kind):
    """Validate one row sent back by the browser, or return None to drop it."""
    if not isinstance(x, dict):
        return None
    try:
        date = str(x.get("date", ""))[:10]
        datetime.strptime(date, "%Y-%m-%d")
        amount = float(x.get("amount"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(amount) or amount <= 0 or amount > 1e9:
        return None
    category = str(x.get("category", ""))
    if kind == "credit":
        category = CREDIT_CATEGORY
    elif category not in CATEGORIES:
        category = "Other"
    return {
        "date": date,
        "description": str(x.get("description", ""))[:300],
        "amount": amount,
        "category": category,
        "payee": str(x.get("payee", ""))[:120],
        "account": str(x.get("account", ""))[:8],
        "ref": str(x.get("ref", ""))[:32],
        "kind": kind,
        "source": str(x.get("source", ""))[:12],
    }


def load_existing(raw: str):
    if not raw.strip():
        return [], []
    try:
        obj = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not read your current list. Please try again.")
    if not isinstance(obj, dict):
        return [], []
    spend = [r for r in (clean_row(x, "expense") for x in obj.get("transactions") or []) if r]
    credits = [r for r in (clean_row(x, "credit") for x in obj.get("credits") or []) if r]
    return spend, credits


def learned_categories(db, user, existing_spend):
    """Remember what the user chose for each payee: saved rows, plus edits made in this session."""
    votes = defaultdict(Counter)
    if user is not None:
        rows = db.execute(
            select(Expense.payee, Expense.category).where(
                Expense.user_id == user.id, Expense.kind == "expense", Expense.payee != ""
            )
        ).all()
        for payee, category in rows:
            if category in CATEGORIES:
                votes[payee][category] += 1
    for r in existing_spend:
        if r["source"] == "user" and r["payee"]:
            votes[r["payee"]][r["category"]] += 3
    return {payee: c.most_common(1)[0][0] for payee, c in votes.items()}


def merge_import(parsed, old_spend, old_credits, memory):
    """Combine freshly parsed statements with what is already on screen. Pure function, no I/O."""
    seen = {(r["kind"], r["ref"]) for r in old_spend + old_credits if r["ref"]}
    new_spend, new_credits, dups = [], [], 0
    for p in parsed:
        for kind, rows, target in (("expense", p["expenses"], new_spend), ("credit", p["credits"], new_credits)):
            for r in rows:
                key = (kind, r["ref"])
                if r["ref"] and key in seen:
                    dups += 1
                    continue
                seen.add(key)
                target.append(
                    {
                        "date": r["date"],
                        "description": r["description"],
                        "amount": r["amount"],
                        "category": r["category"],
                        "payee": r["payee"],
                        "account": r["account"],
                        "ref": r["ref"],
                        "kind": kind,
                        "source": r["source"],
                    }
                )
    for r in new_spend:
        remembered = memory.get(r["payee"])
        if remembered:
            r["category"], r["source"] = remembered, "memory"
    info = {
        "files": len(parsed),
        "added": len(new_spend),
        "credits_added": len(new_credits),
        "duplicates": dups,
        "own_transfers": sum(p["skipped"]["own_transfers"] for p in parsed),
        "refunded": sum(p["skipped"]["refunded"] for p in parsed),
        "to_check": sum(1 for r in new_spend if r["source"] in REVIEW_SOURCES),
        "read": sum(p["found"] for p in parsed),
        "expected": sum(p["expected"] for p in parsed),
    }
    return new_spend, new_credits, info


@router.post("/statements")
async def import_statements(
    files: List[UploadFile] = File(...),
    existing: str = Form(""),
    user: Optional[User] = Depends(optional_user),
    db: Session = Depends(get_db),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Add up to {MAX_FILES} PDFs at a time.")
    parsed = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=400, detail="That PDF is too large. The limit is 10 MB.")
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Only PDF files can be added here.")
        try:
            parsed.append(await run_in_threadpool(statement.parse, data, predict))
        except statement.StatementError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if not any(p["found"] for p in parsed):
        raise HTTPException(
            status_code=400,
            detail="This PDF could not be read as a payment statement.",
        )

    old_spend, old_credits = load_existing(existing)
    memory = learned_categories(db, user, old_spend)
    new_spend, new_credits, info = merge_import(parsed, old_spend, old_credits, memory)

    spend, credits = old_spend + new_spend, old_credits + new_credits
    if not spend and not credits:
        raise HTTPException(
            status_code=400,
            detail="Nothing new to add. Every payment in this file was a transfer between your own accounts, a refund, or already in your list.",
        )
    if len(spend) + len(credits) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"That is more than {MAX_ROWS} transactions in total.")

    resp = full_response(spend, credits)
    resp["import"] = info
    return resp