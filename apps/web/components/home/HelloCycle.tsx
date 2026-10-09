"use client";

import { useEffect, useRef } from "react";

const GREET = ["Hello", "Hola", "Bonjour", "Xin chào", "Olá"];
const LANGS = ["English", "Español", "Français", "Tiếng Việt", "Português"];

/**
 * "Speaks your callers' language": greetings blur-swap every 2.2s and the
 * matching language chip lights up. Static "Hello" + English under reduced
 * motion. The swap is done on the DOM directly (no React re-renders).
 */
export function HelloCycle() {
  const helloRef = useRef<HTMLDivElement>(null);
  const langsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const hello = helloRef.current, langs = langsRef.current;
    if (!hello || !langs || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let gi = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const iv = setInterval(() => {
      if (document.hidden) return;
      const old = hello.querySelector("span:not(.out)");
      gi = (gi + 1) % GREET.length;
      const s = document.createElement("span");
      s.className = "pre";
      s.textContent = GREET[gi];
      hello.appendChild(s);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          s.className = "";
          if (old) old.className = "out";
        }),
      );
      const t = setTimeout(() => {
        timers.delete(t);
        old?.remove();
      }, 800);
      timers.add(t);
      Array.from(langs.children).forEach((l, i) => l.classList.toggle("on", i === gi));
    }, 2200);
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <div className="hello" ref={helloRef} aria-hidden="true">
        <span>Hello</span>
      </div>
      <ul className="langs mono" ref={langsRef} aria-label="Languages">
        {LANGS.map((l, i) => (
          <li key={l} className={i === 0 ? "on" : undefined}>
            {l}
          </li>
        ))}
      </ul>
    </>
  );
}
