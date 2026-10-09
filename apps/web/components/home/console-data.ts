/**
 * Simulated calls for the homepage voice console (copy from the Voice Core
 * prototype). Each script line can fill ticket rows (index), the total ('t')
 * or the status ('s') once it has been spoken.
 */
export const VERTICAL_KEYS = ["salon", "restaurant", "dental", "auto", "home", "retail"] as const;
export type VerticalKey = (typeof VERTICAL_KEYS)[number];

type Fill = number | "t" | "s";
export type ScriptLine = { w: "a" | "c"; ts: string; t: string; f?: Fill[]; act?: string };
export type CallData = {
  label: string;
  color: string;
  agent: string;
  caller: string;
  line: string;
  id: string;
  dur: string;
  ticket: { kind: string; id: string; product: string; rows: [string, string][]; totalLabel: string; total: string; status: string };
  script: ScriptLine[];
};

export const CALLS: Record<VerticalKey, CallData> = {
  salon: {
    label: "Salon", color: "var(--v-salon)", agent: "Sonorch", caller: "Returning client · Jess M.", line: "(941) ••• 0172 · Main St", id: "LMR-1008-2214", dur: "01:06",
    ticket: {
      kind: "Appointment", id: "APT-4182", product: "Sonorch",
      rows: [["Service", "Balayage + gloss · 90 min"], ["Stylist", "Maya R."], ["When", "Thu · 2:30 pm"], ["Deposit", "$25.00 · paid by link"]],
      totalLabel: "Est. total", total: "$185.00", status: "Booked",
    },
    script: [
      { w: "c", ts: "00:02", t: "Hi, can I get a balayage with Maya sometime Thursday?" },
      { w: "a", ts: "00:06", t: "Hi Jess, welcome back. Maya has 2:30 Thursday for a 90-minute balayage. Want a gloss with that?", f: [0, 1], act: "Recognized regular" },
      { w: "c", ts: "00:15", t: "Yes, add the gloss. 2:30 works.", f: [2] },
      { w: "a", ts: "00:19", t: "Done. There's a $25 deposit to hold it. I'm texting you a secure link now.", f: ["t"], act: "Checked live calendar" },
      { w: "c", ts: "00:41", t: "Paid. Thank you!", f: [3] },
      { w: "a", ts: "00:44", t: "You're booked for Thursday at 2:30 with Maya. See you then.", f: ["s"], act: "Deposit via processor" },
    ],
  },
  restaurant: {
    label: "Restaurant", color: "var(--v-restaurant)", agent: "SeasonX", caller: "New caller · pickup", line: "(813) ••• 4410 · Downtown", id: "LMR-1008-2231", dur: "00:58",
    ticket: {
      kind: "Pickup order", id: "ORD-0917", product: "SeasonX",
      rows: [["Items", "2× Birria tacos · 1× Horchata"], ["Modifiers", "Extra consommé · 1× no cilantro"], ["Pickup", "Today · 6:40 pm"], ["Payment", "Paid by text link"]],
      totalLabel: "Total", total: "$21.40", status: "Sent to kitchen",
    },
    script: [
      { w: "c", ts: "00:01", t: "Hey, I'd like a pickup order. Two birria tacos and a horchata." },
      { w: "a", ts: "00:05", t: "Two birria tacos and one horchata. Any changes, like extra consommé or no onions?", f: [0], act: "Read live menu" },
      { w: "c", ts: "00:13", t: "Extra consommé, and no cilantro on one.", f: [1] },
      { w: "a", ts: "00:17", t: "Got it. That's $21.40, ready at 6:40. Want to pay now by text?", f: [2, "t"], act: "Quoted kitchen time" },
      { w: "c", ts: "00:24", t: "Yes please.", f: [3] },
      { w: "a", ts: "00:39", t: "Paid and sent to the kitchen. See you at 6:40.", f: ["s"], act: "Ticket to kitchen" },
    ],
  },
  dental: {
    label: "Dental", color: "var(--v-dental)", agent: "Lumoras Voice", caller: "Patient · Daniel O.", line: "(727) ••• 9083 · Bayfront Dental", id: "LMR-1008-2240", dur: "00:52",
    ticket: {
      kind: "Reschedule", id: "APT-7730", product: "Lumoras POS",
      rows: [["Visit", "Cleaning · 60 min"], ["Moved to", "Tue · 9:00 am"], ["Hygienist", "Dana K."], ["Forms", "New-patient forms texted"]],
      totalLabel: "Est. copay", total: "$0.00", status: "Rescheduled",
    },
    script: [
      { w: "c", ts: "00:02", t: "I need to move my cleaning. I can't make Friday." },
      { w: "a", ts: "00:05", t: "No problem, Daniel. Next Tuesday has 9:00 or 11:30 with Dana. Which works?", f: [0, 2], act: "Found open chairs" },
      { w: "c", ts: "00:12", t: "9:00 is perfect.", f: [1] },
      { w: "a", ts: "00:15", t: "Moved to Tuesday at 9:00. Your new-patient forms aren't done yet, so I'll text them now.", f: ["t"], act: "Moved appointment" },
      { w: "c", ts: "00:24", t: "Great, thanks." },
      { w: "a", ts: "00:26", t: "Sent. You'll get a reminder the day before.", f: [3, "s"], act: "Forms sent" },
    ],
  },
  auto: {
    label: "Auto", color: "var(--v-auto)", agent: "Lumoras Voice", caller: "Customer · 2019 RAV4", line: "(941) ••• 5521 · Westside Auto", id: "LMR-1008-2252", dur: "01:11",
    ticket: {
      kind: "Service order", id: "RO-3391", product: "Lumoras POS",
      rows: [["Service", "60,000-mile service"], ["Vehicle", "2019 Toyota RAV4"], ["Drop-off", "Fri · 8:00 am · Bay 2"], ["Loaner", "Reserved"]],
      totalLabel: "Quote", total: "$389.00", status: "Bay held",
    },
    script: [
      { w: "c", ts: "00:02", t: "How much is the 60,000-mile service on a 2019 RAV4?" },
      { w: "a", ts: "00:06", t: "For a 2019 RAV4 it's $389, with fluids, filters and a brake inspection.", f: [0, 1, "t"], act: "Priced from service menu" },
      { w: "c", ts: "00:16", t: "Can I drop it off Friday morning?" },
      { w: "a", ts: "00:19", t: "Friday at 8:00 is open in bay 2. Should I hold it and line up a loaner?", f: [2], act: "Held drop-off bay" },
      { w: "c", ts: "00:28", t: "Yes to both.", f: [3] },
      { w: "a", ts: "00:30", t: "Held: Friday 8:00, bay 2, loaner reserved. I'm texting the confirmation.", f: ["s"], act: "Loaner reserved" },
    ],
  },
  home: {
    label: "Home services", color: "var(--v-home)", agent: "Lumoras Voice", caller: "Homeowner · after hours", line: "(813) ••• 7712 · North Tampa", id: "LMR-1008-2307", dur: "01:24",
    ticket: {
      kind: "Dispatch", id: "JOB-5128", product: "Lumoras POS",
      rows: [["Issue", "No heat · gas furnace"], ["Priority", "Urgent · kids at home"], ["Tech", "Marcus T. · on call"], ["ETA", "Tonight · 7:45 pm"]],
      totalLabel: "Diagnostic fee", total: "$89.00", status: "Dispatched",
    },
    script: [
      { w: "c", ts: "00:01", t: "Our furnace stopped and it's 58 degrees in here." },
      { w: "a", ts: "00:04", t: "I'm sorry. First, do you smell gas? And is anyone at home very young or elderly?", f: [0], act: "Safety triage" },
      { w: "c", ts: "00:12", t: "No gas. Two little kids, though.", f: [1] },
      { w: "a", ts: "00:16", t: "I'm making this urgent. Marcus, our on-call tech, can be there by 7:45 tonight.", f: [2, 3], act: "Paged on-call tech" },
      { w: "c", ts: "00:27", t: "Please send him." },
      { w: "a", ts: "00:29", t: "Dispatched. The diagnostic fee is $89. Marcus will text when he is on the way.", f: ["t", "s"], act: "ETA texted" },
    ],
  },
  retail: {
    label: "Retail", color: "var(--v-retail)", agent: "Lumoras Voice + Sound", caller: "Shopper · curbside", line: "(941) ••• 3048 · 2nd Ave flagship", id: "LMR-1008-2319", dur: "00:47",
    ticket: {
      kind: "Hold for pickup", id: "HLD-2214", product: "Lumoras POS",
      rows: [["Item", "Linen camp shirt · M · Sand"], ["Store", "2nd Ave flagship"], ["Pickup", "Curbside · 5:00 pm"], ["Sound", "Arrival announcement queued"]],
      totalLabel: "Item price", total: "$68.00", status: "On hold",
    },
    script: [
      { w: "c", ts: "00:02", t: "Do you have the linen camp shirt in a medium, in sand?" },
      { w: "a", ts: "00:05", t: "The 2nd Ave store has two in medium, sand. Want me to hold one for you?", f: [0, 1, "t"], act: "Checked store inventory" },
      { w: "c", ts: "00:13", t: "Yes, I can grab it curbside at 5.", f: [2] },
      { w: "a", ts: "00:16", t: "It's held under this number. Tap the link in my text when you pull up.", act: "Placed hold" },
      { w: "c", ts: "00:24", t: "Perfect." },
      { w: "a", ts: "00:26", t: "When you arrive, the team hears a curbside call at the door. See you at 5.", f: [3, "s"], act: "Curbside announcement" },
    ],
  },
};
