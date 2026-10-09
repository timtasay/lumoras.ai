"use client";

import { ThemeControl as BaseThemeControl } from "@lumoras/ui-tokens/theme-control";
import { Icon } from "./Icons";

/** Light · Dark · Auto control from @lumoras/ui-tokens, drawn with this site's icon sprite. */
export function ThemeControl() {
  return <BaseThemeControl renderIcon={(name) => <Icon name={name} />} />;
}
