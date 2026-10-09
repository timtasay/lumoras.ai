/** Shared demo-request schema, used by the form (client) and /api/demo (server). */
export const LOCATION_OPTIONS = ["1", "2–5", "6–25", "26–100", "100+"] as const;
export const INDUSTRY_OPTIONS = [
  "Salon, barber or spa",
  "Med spa",
  "Restaurant, café or bar",
  "Retail store",
  "Medical or dental clinic",
  "Auto service",
  "Home services",
  "Fitness or wellness studio",
  "Hotel or hospitality",
  "Veterinary or pet grooming",
  "Legal or accounting",
  "Property management",
  "Education or tutoring",
  "Repair shop",
  "Something else",
] as const;
export const INTEREST_OPTIONS = ["Voice", "POS", "Retail orders", "Enterprise"] as const;

export type DemoRequest = {
  name: string;
  email: string;
  company: string;
  locations: string;
  industry: string;
  interests: string[];
};

export type DemoErrors = Partial<Record<keyof DemoRequest, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateDemo(input: Partial<Record<keyof DemoRequest, unknown>>): { value: DemoRequest; errors: DemoErrors } {
  const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const value: DemoRequest = {
    name: s(input.name, 120),
    email: s(input.email, 200),
    company: s(input.company, 160),
    locations: s(input.locations, 20),
    industry: s(input.industry, 80),
    interests: Array.isArray(input.interests)
      ? input.interests.filter((x): x is string => typeof x === "string" && (INTEREST_OPTIONS as readonly string[]).includes(x))
      : [],
  };
  const errors: DemoErrors = {};
  if (!value.name) errors.name = "Please enter your name.";
  if (!value.email) errors.email = "Please enter your work email.";
  else if (!EMAIL_RE.test(value.email)) errors.email = "Please enter a valid work email.";
  if (!value.company) errors.company = "Please enter your company.";
  if (!(LOCATION_OPTIONS as readonly string[]).includes(value.locations)) errors.locations = "Please choose how many locations you run.";
  if (!(INDUSTRY_OPTIONS as readonly string[]).includes(value.industry)) errors.industry = "Please choose your industry.";
  return { value, errors };
}
