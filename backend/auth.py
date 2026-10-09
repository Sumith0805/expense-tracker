import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from db import Expense, User, get_db

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
ALGORITHM = "HS256"
TOKEN_DAYS = 7

ph = PasswordHasher()
bearer = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


def make_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Please sign in.")
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user = db.get(User, int(payload["sub"]))
    except Exception:
        raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.")
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in.")
    return user


@router.post("/register")
def register(body: Credentials, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if len(email) > 254 or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Use a password with at least 8 characters.")
    if len(body.password) > 128:
        raise HTTPException(status_code=400, detail="That password is too long.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=email, password_hash=ph.hash(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": make_token(user.id), "email": user.email}


@router.post("/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    ok = False
    if user:
        try:
            ok = ph.verify(user.password_hash, body.password)
        except (VerifyMismatchError, InvalidHashError):
            ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return {"token": make_token(user.id), "email": user.email}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"email": user.email}


@router.delete("/me")
def delete_account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(Expense).where(Expense.user_id == user.id))
    db.delete(user)
    db.commit()
    return {"deleted": True}