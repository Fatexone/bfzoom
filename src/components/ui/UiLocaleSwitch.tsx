"use client";

import { useUiLocale } from "@/components/ui/UiLocaleProvider";

type UiLocaleSwitchProps = {
  className?: string;
  theme?: "light" | "dark";
};

export default function UiLocaleSwitch({
  className = "",
  theme = "light",
}: UiLocaleSwitchProps) {
  const { locale, setLocale } = useUiLocale();
  const isDark = theme === "dark";

  const containerClass = isDark
    ? "inline-flex items-center rounded-full border border-white/12 bg-white/[0.08] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm"
    : "inline-flex items-center rounded-full border border-slate-300 bg-white/95 p-1 shadow-sm";

  const activeClass = isDark
    ? "bg-white text-slate-950 shadow-sm"
    : "bg-slate-950 text-white shadow-sm";

  const idleClass = isDark
    ? "text-white/80 hover:text-white"
    : "text-slate-600 hover:text-slate-950";

  return (
    <div className={`${containerClass} ${className}`.trim()}>
      {(["fr", "en"] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setLocale(item)}
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
            locale === item ? activeClass : idleClass
          }`}
          aria-pressed={locale === item}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
