/** IANA time zones from the server's ICU data (computed on the server so SSR and the client agree). */
export function timezones(): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...all.filter((z) => z !== "UTC")];
}
