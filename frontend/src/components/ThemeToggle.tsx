export type Theme = "light" | "dark" | "auto";

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "auto", auto: "light" };

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
  labels: { switchToLight: string; switchToDark: string; switchToAuto: string };
}

const LABEL_KEY: Record<Theme, keyof ThemeToggleProps["labels"]> = {
  light: "switchToLight",
  dark: "switchToDark",
  auto: "switchToAuto",
};

export function ThemeToggle({ theme, onChange, labels }: ThemeToggleProps) {
  const next = NEXT[theme];

  return (
    <button type="button" class="theme-toggle" onClick={() => onChange(next)} aria-label={labels[LABEL_KEY[next]]}>
      {theme === "light" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
      {theme === "dark" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 1 0 20.354 15.354Z" />
        </svg>
      )}
      {theme === "auto" && (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  );
}
