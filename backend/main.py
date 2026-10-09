import io

import joblib
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analytics import build_response
from auth import router as auth_router
from db import init_db
from expenses import router as expenses_router

app = FastAPI(title="Expense Categorizer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
app.include_router(auth_router)
app.include_router(expenses_router)

model = joblib.load("model.joblib")


class Item(BaseModel):
    description: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(item: Item):
    text = item.description.lower()
    return {
        "description": item.description,
        "category": str(model.predict([text])[0]),
    }


@app.post("/categorize")
async def categorize(file: UploadFile = File(...)):
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the CSV file")
    if "description" not in df.columns:
        raise HTTPException(status_code=400, detail="CSV needs a 'description' column")
    df["category"] = model.predict(df["description"].astype(str).str.lower())
    df = df.fillna("")
    return {"rows": len(df), "transactions": df.to_dict(orient="records")}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the CSV file")
    if not {"date", "description", "amount"}.issubset(df.columns):
        raise HTTPException(status_code=400, detail="CSV needs date, description and amount columns")
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["amount", "date"]).reset_index(drop=True)
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    df["category"] = model.predict(df["description"].astype(str).str.lower())
    return build_response(df)