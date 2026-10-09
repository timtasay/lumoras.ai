/** Voice Core accent rotation for cards that carry a coloured top hairline (topics, categories, About). */
const TONES = ["var(--v-salon)", "var(--v-restaurant)", "var(--v-dental)", "var(--v-retail)"] as const;

export function tone(n: number): string {
  return TONES[((n % TONES.length) + TONES.length) % TONES.length];
}
