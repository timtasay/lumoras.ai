import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon="search"
        title="Nothing at this address"
        text="The page may have moved, or it belongs to a phase that is not built yet."
        primary={
          <Link href="/" className={buttonClass("primary")}>
            Back to the overview
          </Link>
        }
      />
    </div>
  );
}
