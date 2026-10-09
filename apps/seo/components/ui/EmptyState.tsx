import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";

/**
 * Designed empty state: a quiet illustration, what is missing, why it
 * matters, and the next action as the primary button.
 */
export function EmptyState({
  icon = "calendar",
  title,
  text,
  primary,
  secondary,
}: {
  icon?: IconName;
  title: string;
  text: string;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="empty panel">
      <div className="empty-art" aria-hidden="true">
        <span className="empty-ring r1" />
        <span className="empty-ring r2" />
        <span className="empty-core">
          <Icon name={icon} />
        </span>
      </div>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-text">{text}</p>
      <div className="empty-acts">
        {primary}
        {secondary}
      </div>
    </div>
  );
}
