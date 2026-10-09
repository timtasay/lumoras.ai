import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClass } from "@/components/ui/Button";

/** One answer for "does not exist" and "not yours": nothing reveals that another workspace exists. */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="nf">
      <EmptyState
        icon="search"
        title="Nothing at this address"
        text="It may have moved, it belongs to a phase that is not built yet, or it is in a workspace you are not a member of."
        primary={
          <Link href="/" className={buttonClass("primary")}>
            Back to your workspaces
          </Link>
        }
      />
    </main>
  );
}
