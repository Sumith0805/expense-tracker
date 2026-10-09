import os
import random
from datetime import date, timedelta
import pandas as pd

random.seed(42)

CATEGORIES = {
    "Food": (["SWIGGY", "ZOMATO", "DOMINOS", "MCDONALDS", "KFC", "STARBUCKS", "BEHROUZ BIRYANI", "PISTA HOUSE"], (120, 900), 30),
    "Groceries": (["BIGBASKET", "BLINKIT", "ZEPTO", "DMART", "RELIANCE FRESH", "MORE SUPERMARKET"], (150, 2500), 15),
    "Transport": (["UBER", "OLA CABS", "RAPIDO", "TSRTC", "HYDERABAD METRO", "INDIAN OIL", "HP PETROL PUMP"], (30, 600), 20),
    "Shopping": (["AMAZON", "FLIPKART", "MYNTRA", "AJIO", "MEESHO", "DECATHLON"], (250, 4000), 8),
    "Bills": (["JIO RECHARGE", "AIRTEL", "ACT FIBERNET", "ELECTRICITY BILL", "HDFC CREDIT CARD", "DTH RECHARGE"], (200, 2500), 6),
    "Entertainment": (["NETFLIX", "SPOTIFY", "BOOKMYSHOW", "PVR CINEMAS", "HOTSTAR", "YOUTUBE PREMIUM"], (100, 900), 5),
    "Health": (["APOLLO PHARMACY", "MEDPLUS", "PHARMEASY", "1MG", "CULT FIT"], (80, 2500), 4),
    "Education": (["UDEMY", "COURSERA", "UNACADEMY", "GEEKSFORGEEKS", "KINDLE STORE"], (300, 3500), 2),
    "Transfers": (["RAHUL KUMAR", "PRIYA SHARMA", "AMIT REDDY", "SNEHA RAO", "VIKRAM SINGH", "ANITHA K"], (100, 3000), 10),
}

def make_description(merchant):
    ref = random.randint(100000, 999999)
    style = random.choice(["upi", "pay", "pos", "plain"])
    if style == "upi":
        text = f"UPI/{merchant}/{ref}"
    elif style == "pay":
        text = f"{merchant} PAYMENT {ref}"
    elif style == "pos":
        text = f"POS {merchant} HYDERABAD"
    else:
        text = merchant
    if random.random() < 0.3:
        text = text.lower()
    if random.random() < 0.1:
        text = text[: max(8, len(text) - random.randint(2, 6))]
    return text

def main(n=1500):
    names = list(CATEGORIES)
    weights = [CATEGORIES[c][2] for c in names]
    start = date(2025, 10, 1)
    rows = []
    for _ in range(n):
        cat = random.choices(names, weights=weights)[0]
        merchants, (lo, hi), _w = CATEGORIES[cat]
        merchant = random.choice(merchants)
        amount = round(lo + (hi - lo) * random.random() ** 2, 2)
        day = start + timedelta(days=random.randint(0, 364))
        rows.append({
            "date": day.isoformat(),
            "description": make_description(merchant),
            "amount": amount,
            "category": cat,
        })
    df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    os.makedirs("data", exist_ok=True)
    df.to_csv("data/transactions.csv", index=False)
    print("Saved", len(df), "transactions")
    print(df["category"].value_counts())

if __name__ == "__main__":
    main()