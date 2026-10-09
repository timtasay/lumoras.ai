import Link from "next/link";
import { Icon } from "./Icons";
import { CallChip } from "./CallChip";

/** Closing call to action used at the bottom of inner pages. */
export function CtaBand({
  title = "Hear it answer your phone.",
  text = "Call the live demo line and talk to the AI receptionist yourself, or book a walkthrough of voice and POS for your locations.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section className="ctaband panel" aria-labelledby="cta-band-h">
      <div>
        <h2 id="cta-band-h" className="ctaband-title">{title}</h2>
        <p>{text}</p>
      </div>
      <div className="ctaband-actions">
        <Link className="btn btn-primary" href="/demo">
          Book a demo <Icon name="arrow" />
        </Link>
        <CallChip />
      </div>
    </section>
  );
}
