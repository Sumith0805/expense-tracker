import joblib
import mlflow
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

df = pd.read_csv("data/transactions.csv")
X = df["description"].str.lower()
y = df["category"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

models = {
    "logreg": LogisticRegression(max_iter=1000),
    "linear_svc": LinearSVC(),
}

mlflow.set_tracking_uri("sqlite:///mlflow.db")
mlflow.set_experiment("expense-categorizer")

best_f1, best_pipe, best_name = -1, None, None
for name, clf in models.items():
    pipe = Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))),
        ("clf", clf),
    ])
    with mlflow.start_run(run_name=name):
        pipe.fit(X_train, y_train)
        pred = pipe.predict(X_test)
        acc = accuracy_score(y_test, pred)
        f1 = f1_score(y_test, pred, average="macro")
        mlflow.log_param("model", name)
        mlflow.log_param("ngram_range", "2-4")
        mlflow.log_param("train_rows", len(X_train))
        mlflow.log_metric("accuracy", acc)
        mlflow.log_metric("macro_f1", f1)
        print(f"{name}: accuracy={acc:.3f} macro_f1={f1:.3f}")
    if f1 > best_f1:
        best_f1, best_pipe, best_name = f1, pipe, name

joblib.dump(best_pipe, "model.joblib")
print("Saved best model:", best_name)