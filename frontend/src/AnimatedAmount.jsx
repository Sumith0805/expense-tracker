import { useEffect, useRef, useState } from "react";
import { lakh } from "./lib";

const reduce =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function AnimatedAmount({ value, duration = 1100 }) {
  const [shown, setShown] = useState(reduce ? value : 0);
  const current = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      current.current = value;
      setShown(value);
      return;
    }
    const begin = current.current;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = begin + (value - begin) * eased;
      setShown(current.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span>
      <span aria-hidden="true">{lakh(shown)}</span>
      <span className="sr">{lakh(value)}</span>
    </span>
  );
}
