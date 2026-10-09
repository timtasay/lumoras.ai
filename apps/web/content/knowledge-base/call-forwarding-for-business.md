---
title: "Call Forwarding for Business: Setup, Codes and Testing"
description: "Learn the types of call forwarding for business, the common dial codes, when to port your number instead, and how to test forwarding before you rely on it."
topic: "phone-lines"
updated: "2026-09-29"
readingMinutes: 7
keyword: "call forwarding for business"
keyPoints:
  - "Unconditional forwarding sends every call onward, while conditional forwarding only kicks in when your line is busy, unanswered or unreachable."
  - "Forwarding keeps your number with your current carrier and porting moves it to a new provider, so start with forwarding while you try a service."
  - "Dial codes differ by carrier and plan, so confirm them with your carrier and test every condition from an outside phone."
order: 4
---

Call forwarding for business sends calls that arrive on your existing number to another number, such as a cell phone, a second location, an answering service or an AI receptionist. You can forward every call, or only when the line is busy, unanswered or unreachable. It's usually a setting or a short dial code, and it lets you change who answers without changing the number your customers already know.

## How forwarding works

Your number lives with a carrier: a mobile network, a landline provider or a VoIP service. When forwarding is on, the carrier redirects incoming calls to the destination you set. The caller dials the number they always dial and never sees the change.

In most setups the destination sees the original caller's number. That matters if your receptionist recognizes regulars by caller ID. Confirm it on your own line, because some systems pass along the forwarding number instead.

Two things to know up front:

- **Forwarded calls can use minutes.** The forwarded leg is effectively a second call. Many plans include it. Some business and mobile plans charge for it or cap it.
- **Forwarding can be locked.** Some business plans disable forwarding features, or only let the account owner turn them on.

## Unconditional vs. conditional forwarding

### Unconditional forwarding

Every call goes straight to the destination and your phones don't ring. Use it when another person or system should answer everything, such as a full-time AI receptionist, or when you are closed.

### Conditional forwarding

Calls forward only under certain conditions:

- **No answer.** The phone rings for a set time, then forwards. This is the classic overflow setup: staff get the first chance and the receptionist takes whatever nobody picks up. On many mobile networks you can set the ring time somewhere between 5 and 30 seconds.
- **Busy.** If the line is already on a call, the next caller forwards instead of hearing a busy signal or going to voicemail. On a single-line business, this alone can catch a lot of calls.
- **Unreachable.** If the phone is off, out of signal or in airplane mode, calls forward. Useful for trades who work in basements, crawl spaces and rural areas.

You can usually set all three at once, pointed at the same destination.

### Simultaneous and sequential ring

Office and VoIP phone systems often add two related options. **Simultaneous ring** rings several phones at once, such as the front desk and the owner's cell, and the first to pick up gets the call. **Sequential ring**, sometimes called find-me follow-me, tries one phone, then the next, in an order you set. Both are handy for small teams. You can still put conditional forwarding at the end of the chain, so a call that nobody answers reaches the receptionist instead of voicemail.

### Which setup fits

- **A salon** that wants the front desk to answer when free: no answer (around 15 to 20 seconds) plus busy.
- **A restaurant** that wants the AI to take every phone order during service: unconditional, at least for service hours.
- **A plumber who works alone:** busy, no answer and unreachable, all to the receptionist, with urgent calls transferred to the cell phone.
- **A clinic with a phone system:** schedule rules in the phone system, with overflow during the day and everything forwarded after hours.
- **A retail shop with one line:** busy plus no answer, so a call during a rush on the floor still gets picked up.

## Common forwarding codes

Many phones and carriers accept dial codes. Treat the lists below as a starting point. Codes vary by carrier, plan and phone system, so confirm the right ones with your carrier before you rely on them.

### GSM codes (used on many mobile networks)

- Forward all calls: `**21*number#`
- Forward when there's no answer: `**61*number#`
- Forward when busy: `**67*number#`
- Forward when unreachable: `**62*number#`
- Forward in all conditional cases: `**004*number#`
- Check whether all-call forwarding is on: `*#21#`
- Cancel all-call forwarding: `##21#`
- Cancel all forwarding: `##002#`

Replace "number" with the full destination number, usually with the country code (for example, +1 in the US). Dial the code, press call and wait for the confirmation message on screen.

### Star codes (many US landline and VoIP lines, and some carriers)

- `*72` turns on forwarding of all calls. Dial it, then the destination number, and follow the prompts. On some lines the destination has to answer to confirm.
- `*73` turns it off.

Some providers use other codes for busy or no-answer forwarding, or only offer conditional forwarding in an online portal or app. On hosted VoIP and office phone systems you usually set forwarding in the admin portal, where you can add schedules, ring groups and separate rules per number.

## Forwarding vs. porting

**Forwarding** keeps your number with your current carrier and points calls elsewhere. It's quick, easy to reverse and usually cheap. You keep paying your carrier, and calls take an extra hop.

**Porting** moves the number itself to a new provider. In the US, number portability rules let you take your number with you. You'll typically need the account number, a port-out PIN or passcode, the name and address on the account, and sometimes a recent bill. A port can take anywhere from a day to a few weeks depending on the carriers and the type of number. Keep the old service active until the port completes, since cancelling first can release the number.

Choose **forwarding** when you're trying a service, when the number is tied to other things (an alarm line, a bundle with your internet), or when you want an easy way back. Choose **porting** when you're moving your whole phone setup to a new provider and want to drop the old one.

For an AI receptionist, forwarding is almost always the right place to start. You can port later if you consolidate providers.

## Setting it up for an AI receptionist

1. **Get the destination number** from your receptionist provider.
2. **Pick the conditions:** everything, or overflow only (no answer, busy, unreachable).
3. **Turn it on** with a dial code, your carrier's app or portal, or your phone system's admin settings.
4. **Set transfer targets that don't forward.** When the AI sends a call back to staff, it should ring a direct line or cell that isn't forwarded to the AI. Otherwise you create a loop.
5. **Match your hours.** If forwarding only runs after hours, set that schedule in the phone system and set matching [answering hours](/help-center/answering-hours) on the receptionist.

For Lumoras products, the steps are in [connect your phone number](/help-center/connect-your-phone-number) and [live call transfer](/help-center/live-call-transfer).

## Testing forwarding

Test before you announce anything, using a phone that isn't on your account.

- **Unconditional:** call your business number. It should reach the destination without ringing your phones.
- **No answer:** let it ring and time how long it takes to forward.
- **Busy:** call from one phone, then call again from another while the first call is still live.
- **Unreachable:** switch the phone off or to airplane mode, then call.
- **Caller ID:** check which number the destination sees.
- **Transfers:** ask the receptionist for a person and confirm the call reaches staff without looping.
- **After hours:** repeat the tests at night if you use schedules.

### Common problems

- **Voicemail answers first.** If carrier voicemail picks up after four rings and your no-answer forwarding waits longer, voicemail wins. Shorten the forwarding delay or turn off carrier voicemail.
- **Only one line forwards.** The setting may apply to a single line in a group or to one device. Check every number customers actually call.
- **Your listed number is different.** Your website, map listings and directories may show an older number. Forward that one too, or update the listings.
- **Call quality drops.** Each hop adds a little delay. If calls sound poor, test from several phones and ask your carrier or provider how the calls are routed.

## What forwarding costs

Forwarding itself is often included in business plans. Costs come from forwarded minutes on plans that bill for them, add-ons such as scheduled forwarding or simultaneous ring, and the service you forward to. AI receptionists and answering services usually charge per minute, per call or a flat monthly fee. Ask your carrier how forwarded minutes are billed before you send every call out.

## Questions to ask your carrier

- Which forwarding types does my plan support: all calls, busy, no answer, unreachable?
- Are forwarded calls billed, and how?
- Will the destination see the original caller ID?
- Can I set the ring time before no-answer forwarding?
- Can forwarding follow a schedule?
- What will you need from me if I port this number out later?

Once forwarding works, the rest is about what happens to the call. Read [what an AI receptionist is](/knowledge-base/what-is-an-ai-receptionist), or [book a demo](/demo) to hear one answer calls for a business like yours.
