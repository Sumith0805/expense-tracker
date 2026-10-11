from datetime import datetime
from math import isfinite
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from auth import current_user
from db import Expense, User, get_db
from ledger import CATEGORIES, CREDIT_CATEGORY, full_response

router = APIRouter(prefix="/expenses", tags=["expenses"])

MAX_ROWS = 5000


class Row(BaseModel):
    date: str
    description: str
    amount: float
    category: str
    payee: str = ""
    account: str = ""
    ref: str = ""
    kind: str = "expense"


def check(r: Row):
    try:
        datetime.strptime(r.date[:10], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="A transaction has an invalid date.")
    if not isfinite(r.amount) or r.amount <= 0 or r.amount > 1e9:
        raise HTTPException(status_code=400, detail="A transaction has an invalid amount.")
    if r.kind not in ("expense", "credit"):
        raise HTTPException(status_code=400, detail="A transaction has an unknown type.")
    if r.kind == "credit":
        if r.category != CREDIT_CATEGORY:
            raise HTTPException(status_code=400, detail="A credit has an unknown category.")
    elif r.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="A transaction has an unknown category.")


@router.put("")
def replace_all(
    rows: List[Row],
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"You can save up to {MAX_ROWS} transactions.")
    for r in rows:
        check(r)
    db.execute(delete(Expense).where(Expense.user_id == user.id))
    db.add_all(
        [
            Expense(
                user_id=user.id,
                date=r.date[:10],
                description=r.description[:300],
                amount=r.amount,
                category=r.category,
                kind=r.kind,
                account=r.account[:8],
                payee=r.payee[:120],
                ref=r.ref[:32],
            )
            for r in rows
        ]
    )
    db.commit()
    return {"saved": len(rows)}


def _as_dict(e: Expense):
    return {
        "date": e.date,
        "description": e.description,
        "amount": e.amount,
        "category": e.category,
        "payee": e.payee or "",
        "account": e.account or "",
        "ref": e.ref or "",
    }


@router.get("/analysis")
def my_analysis(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(Expense).where(Expense.user_id == user.id).order_by(Expense.date)
    ).all()
    if not items:
        return {"rows": 0}
    spend = [_as_dict(e) for e in items if (e.kind or "expense") != "credit"]
    credits = [_as_dict(e) for e in items if e.kind == "credit"]
    return full_response(spend, credits)


@router.delete("")
def delete_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(Expense).where(Expense.user_id == user.id))
    db.commit()
    return {"deleted": True}