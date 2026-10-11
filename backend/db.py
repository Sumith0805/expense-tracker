import os

from sqlalchemy import Float, ForeignKey, String, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# Force the psycopg2 driver (installed via psycopg2-binary) for Postgres URLs
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[str] = mapped_column(String(10))  # stored as "YYYY-MM-DD"
    description: Mapped[str] = mapped_column(String(300))
    amount: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(32))
    # Added for statement imports. "credit" rows are money received, not spending.
    kind: Mapped[str] = mapped_column(String(8), default="expense", server_default="expense")
    account: Mapped[str] = mapped_column(String(8), default="", server_default="")
    payee: Mapped[str] = mapped_column(String(120), default="", server_default="")
    ref: Mapped[str] = mapped_column(String(32), default="", server_default="")


# create_all() never changes a table that already exists, so older databases
# (your local app.db and the live one) get the new columns added here.
NEW_COLUMNS = {
    "kind": "VARCHAR(8) NOT NULL DEFAULT 'expense'",
    "account": "VARCHAR(8) NOT NULL DEFAULT ''",
    "payee": "VARCHAR(120) NOT NULL DEFAULT ''",
    "ref": "VARCHAR(32) NOT NULL DEFAULT ''",
}


def init_db():
    Base.metadata.create_all(bind=engine)
    have = {c["name"] for c in inspect(engine).get_columns("expenses")}
    with engine.begin() as conn:
        for name, ddl in NEW_COLUMNS.items():
            if name not in have:
                conn.execute(text(f"ALTER TABLE expenses ADD COLUMN {name} {ddl}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()