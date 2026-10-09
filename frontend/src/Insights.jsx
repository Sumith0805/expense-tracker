import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CAT_COLORS, fmtDate, inr, inrExact } from "./lib";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const reduce =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

const short = (v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${Math.round(v / 1000)}k`);

export const MonthChart = memo(function MonthChart({ monthly, forecast, month, onSelect, dark }) {
  const rows = useMemo(() => {
    const r = Object.entries(monthly).map(([k, v]) => ({ key: k, month: monthLabel(k), total: v }));
    if (forecast != null) r.push({ key: null, month: "Next", forecast });
    return r;
  }, [monthly, forecast]);

  const grid = dark ? "#263050" : "#D9DEEA";
  const text = dark ? "#E8ECF7" : "#101B38";
  const tick = { fill: dark ? "#9AA6C2" : "#5A6784", fontSize: 13 };
  const barColor = dark ? "#2BB3BF" : "#0E7C86";

  const boxRef = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || seen) return;
    if (!("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const pick = (d) => {
    const k = d?.payload?.key ?? d?.key;
    if (k) onSelect(month === k ? null : k);
  };

  return (
    <section className="section">
      <h2>Month by month</h2>
      <p className="sub">
        {forecast != null
          ? `Next month looks like about ${inr(forecast)}. This is a simple trend estimate from the last six months, so treat it as a rough guide. `
          : "Add at least two months of data to see a forecast. "}
        Tap a month to see only that month.
      </p>
      <div className="chart" ref={boxRef}>
        {seen ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={tick} minTickGap={10} />
              <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={44} tick={tick} />
              <Tooltip
                formatter={(v) => inr(v)}
                cursor={{ fill: dark ? "rgba(232,236,247,0.06)" : "rgba(16,27,56,0.05)" }}
                contentStyle={{
                  background: dark ? "#161D33" : "#FFFFFF",
                  border: `1px solid ${grid}`,
                  borderRadius: 10,
                  color: text,
                }}
                labelStyle={{ color: text }}
                itemStyle={{ color: text }}
              />
              <Bar
                dataKey="total"
                name="Spent"
                stackId="a"
                fill={barColor}
                radius={[6, 6, 0, 0]}
                onClick={pick}
                isAnimationActive={!reduce}
                animationBegin={150}
                animationDuration={900}
                animationEasing="ease-out"
              >
                {rows.map((r, i) => (
                  <Cell key={i} opacity={month && r.key !== month ? 0.35 : 1} />
                ))}
              </Bar>
              <Bar
                dataKey="forecast"
                name="Forecast"
                stackId="a"
                fill="#F2A900"
                radius={[6, 6, 0, 0]}
                isAnimationActive={!reduce}
                animationBegin={1000}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 300 }} />
        )}
      </div>
    </section>
  );
});

export function Unusual({ items }) {
  const top = [...items].sort((a, b) => b.amount - a.amount).slice(0, 8);
  return (
    <section className="section">
      <h2>Unusual spends</h2>
      {top.length === 0 ? (
        <p className="sub">Nothing stands out. Every transaction is within the normal range for its category.</p>
      ) : (
        <>
          <p className="sub">
            {items.length} transactions were far above what is normal for their category. The largest are below.
          </p>
          <ul className="unusual">
            {top.map((t, i) => (
              <li key={i}>
                <span className="dot" style={{ background: CAT_COLORS[t.category] || "#5A6784" }} />
                <span className="u-desc">
                  {t.description}
                  <small>{t.category} on {fmtDate(t.date)}</small>
                </span>
                <span className="num">{inrExact(t.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}