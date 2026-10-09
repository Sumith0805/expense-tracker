import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest


def monthly_totals(df):
    months = pd.to_datetime(df["date"]).dt.to_period("M").astype(str)
    return df.groupby(months)["amount"].sum().round(2)


def find_anomalies(df, contamination=0.03):
    df = df.copy()
    df["is_anomaly"] = False
    for cat, grp in df.groupby("category"):
        if len(grp) < 20:
            continue
        iso = IsolationForest(contamination=contamination, random_state=42)
        flags = iso.fit_predict(grp[["amount"]]) == -1
        high = (grp["amount"] > grp["amount"].median()).values
        df.loc[grp.index, "is_anomaly"] = flags & high
    return df


def forecast_next_month(df):
    totals = monthly_totals(df)
    if len(totals) < 2:
        return None
    y = totals.values[-6:]
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    return round(float(max(0.0, slope * len(y) + intercept)), 2)


def build_response(df):
    df = find_anomalies(df.reset_index(drop=True))
    by_category = df.groupby("category")["amount"].sum().round(2).sort_values(ascending=False)
    return {
        "rows": len(df),
        "total_spent": round(float(df["amount"].sum()), 2),
        "by_category": by_category.to_dict(),
        "monthly_totals": monthly_totals(df).to_dict(),
        "forecast_next_month": forecast_next_month(df),
        "anomalies": df[df["is_anomaly"]].to_dict(orient="records"),
        "transactions": df.to_dict(orient="records"),
    }