export const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const CAT_COLORS = {
  Food: "#E76F51",
  Groceries: "#2A9D8F",
  Transport: "#264E86",
  Shopping: "#A3205A",
  Bills: "#7B6D8D",
  Entertainment: "#F2A900",
  Health: "#4CB963",
  Education: "#8E5572",
  Transfers: "#5A6784",
};

const inrFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inrFmt2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const inr = (n) => inrFmt.format(n);
export const inrExact = (n) => inrFmt2.format(n);

export function lakh(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} crore`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} lakh`;
  return inr(n);
}

export function fmtDate(s) {
  const d = new Date(s + "T00:00:00");
  return isNaN(d)
    ? s
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}