import { useState } from "react";
import { inrExact } from "./lib";

const today = () => new Date().toLocaleDateString("en-CA");

export default function ManualEntry({ onAnalyze, busy }) {
  const [rows, setRows] = useState([]);
  const [date, setDate] = useState(today());
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");

  function add() {
    const amt = parseFloat(amount);
    if (!date || !desc.trim() || !(amt > 0)) {
      setMsg("Add a date, a description and an amount above zero.");
      return;
    }
    setRows([...rows, { date, description: desc.trim(), amount: amt }]);
    setDesc("");
    setAmount("");
    setMsg("");
  }

  function analyse() {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = rows.map((r) => `${r.date},${esc(r.description)},${r.amount}`);
    const csv = ["date,description,amount", ...lines].join("\n");
    onAnalyze(new File([csv], "manual.csv", { type: "text/csv" }));
  }

  return (
    <div className="manual">
      <p className="drop-title">Type your expenses</p>
      <span className="note">
        Use the shop or app name, such as Swiggy, Uber or Netflix, so it can be sorted correctly.
        Add expenses from at least two months to see a forecast.
      </span>
      <div className="m-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input
          placeholder="Description, e.g. Swiggy"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          aria-label="Description"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount in ₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Amount in rupees"
        />
        <button className="btn ghost" onClick={add}>Add</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      {rows.length > 0 && (
        <>
          <ul className="m-list">
            {rows.map((r, i) => (
              <li key={i}>
                <span>{r.date}</span>
                <span>{r.description}</span>
                <span className="num">{inrExact(r.amount)}</span>
                <button className="link" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button className="btn" disabled={busy} onClick={analyse}>
            Analyse {rows.length} {rows.length === 1 ? "expense" : "expenses"}
          </button>
        </>
      )}
    </div>
  );
}