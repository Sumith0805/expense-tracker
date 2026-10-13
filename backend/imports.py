"""Add statement PDFs or bank SMS to the current list of transactions."""
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import joblib
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import sms
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


def clean_existing(obj):
    if not isinstance(obj, dict):
        return [], []
    spend = [r for r in (clean_row(x, "expense") for x in obj.get("transactions") or []) if r]
    credits = [r for r in (clean_row(x, "credit") for x in obj.get("credits") or []) if r]
    return spend, credits


def load_existing(raw: str):
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not read your current list. Please try again.")


def saved_rows(db, user):
    """What the signed-in user already saved, used when nothing is open on screen."""
    items = db.scalars(select(Expense).where(Expense.user_id == user.id).order_by(Expense.date)).all()
    spend, credits = [], []
    for e in items:
        kind = "credit" if e.kind == "credit" else "expense"
        row = clean_row(
            {
                "date": e.date,
                "description": e.description,
                "amount": e.amount,
                "category": e.category,
                "payee": e.payee or "",
                "account": e.account or "",
                "ref": e.ref or "",
            },
            kind,
        )
        if row:
            (credits if kind == "credit" else spend).append(row)
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


def merge_import(parsed, old_spend, old_credits, memory, source="pdf"):
    """Combine freshly parsed rows with what is already on screen. Pure function, no I/O."""
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
        "source": source,
        "files": len(parsed),
        "added": len(new_spend),
        "credits_added": len(new_credits),
        "duplicates": dups,
        "own_transfers": sum(p["skipped"]["own_transfers"] for p in parsed),
        "refunded": sum(p["skipped"]["refunded"] for p in parsed),
        "ignored": sum(p.get("ignored", 0) for p in parsed),
        "to_check": sum(1 for r in new_spend if r["source"] in REVIEW_SOURCES),
        "read": sum(p["found"] for p in parsed),
        "expected": sum(p["expected"] for p in parsed),
    }
    return new_spend, new_credits, info


def finish_import(parsed, existing_obj, user, db, source):
    """Shared by the PDF and SMS endpoints."""
    if existing_obj is None and user is not None:
        old_spend, old_credits = saved_rows(db, user)  # add to what is already saved
    else:
        old_spend, old_credits = clean_existing(existing_obj)
    memory = learned_categories(db, user, old_spend)
    new_spend, new_credits, info = merge_import(parsed, old_spend, old_credits, memory, source)

    spend, credits = old_spend + new_spend, old_credits + new_credits
    if not spend and not credits:
        raise HTTPException(
            status_code=400,
            detail="Nothing new to add. Everything was already in your list, or could not be read as a payment.",
        )
    if len(spend) + len(credits) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"That is more than {MAX_ROWS} transactions in total.")
    resp = full_response(spend, credits)
    resp["import"] = info
    return resp


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
        raise HTTPException(status_code=400, detail="This PDF could not be read as a payment statement.")
    return finish_import(parsed, load_existing(existing), user, db, "pdf")


class SmsMessage(BaseModel):
    sender: str = ""
    body: str
    date: int = 0


class SmsImport(BaseModel):
    messages: List[SmsMessage]
    existing: Optional[dict] = None


@router.post("/sms")
async def import_sms(
    payload: SmsImport,
    user: Optional[User] = Depends(optional_user),
    db: Session = Depends(get_db),
):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="No messages were sent.")
    if len(payload.messages) > sms.MAX_MESSAGES:
        raise HTTPException(status_code=400, detail=f"Send up to {sms.MAX_MESSAGES} messages at a time.")
    parsed = await run_in_threadpool(
        sms.parse_messages, [{"body": m.body} for m in payload.messages], predict
    )
    if not parsed["found"] and not parsed["skipped"]["own_transfers"]:
        raise HTTPException(
            status_code=400,
            detail="None of these messages looked like a payment alert from a supported bank.",
        )
    return finish_import([parsed], payload.existing, user, db, "sms")