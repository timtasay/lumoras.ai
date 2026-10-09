"use client";

import { ThemeControl } from "@lumoras/ui-tokens/theme-control";
import { Icon } from "@/components/Icons";

/** The Light · Dark · Auto control, for pages outside the app shell. */
export function ThemeToggle() {
  return <ThemeControl renderIcon={(n) => <Icon name={n} />} />;
}
