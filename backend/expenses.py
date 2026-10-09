from datetime import datetime
from math import isfinite
from typing import List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from analytics import build_response
from auth import current_user
from db import Expense, User, get_db

router = APIRouter(prefix="/expenses", tags=["expenses"])

MAX_ROWS = 5000
CATEGORIES = {
    "Food", "Groceries", "Transport", "Shopping", "Bills",
    "Entertainment", "Health", "Education", "Transfers",
}


class Row(BaseModel):
    date: str
    description: str
    amount: float
    category: str


def check(r: Row):
    try:
        datetime.strptime(r.date[:10], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="A transaction has an invalid date.")
    if not isfinite(r.amount) or r.amount <= 0 or r.amount > 1e9:
        raise HTTPException(status_code=400, detail="A transaction has an invalid amount.")
    if r.category not in CATEGORIES:
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
            )
            for r in rows
        ]
    )
    db.commit()
    return {"saved": len(rows)}


@router.get("/analysis")
def my_analysis(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(Expense).where(Expense.user_id == user.id).order_by(Expense.date)
    ).all()
    if not items:
        return {"rows": 0}
    df = pd.DataFrame(
        [
            {"date": e.date, "description": e.description, "amount": e.amount, "category": e.category}
            for e in items
        ]
    )
    return build_response(df)


@router.delete("")
def delete_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(Expense).where(Expense.user_id == user.id))
    db.commit()
    return {"deleted": True}