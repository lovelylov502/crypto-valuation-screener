"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "tovenit-theme";
type Theme = "light" | "dark";

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { setStorageError(true); }
      const next = saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", sync); window.removeEventListener("storage", sync); };
  }, []);

  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(KEY, next); setStorageError(false); } catch { setStorageError(true); }
  };

  return <div className="theme-control">
    <div className="theme-switch" role="group" aria-label="화면 모드">
      <button aria-pressed={theme === "light"} onClick={() => choose("light")}><Sun size={17}/><span>밝게</span></button>
      <button aria-pressed={theme === "dark"} onClick={() => choose("dark")}><Moon size={16}/><span>어둡게</span></button>
    </div>
    {storageError && <span className="theme-storage-note" role="status">화면 모드 저장 불가</span>}
  </div>;
}
