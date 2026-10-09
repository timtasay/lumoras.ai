import type { CSSProperties, ReactNode } from "react";

/**
 * Staggered reveal on first render: each child rises in 40ms after the
 * previous one (--stagger), transform + opacity only. Change `replay` to run
 * it again. Reduced motion: everything is simply there.
 */
export function RevealGroup({
  children,
  className,
  replay = 0,
  as: Tag = "div",
}: {
  children: ReactNode[];
  className?: string;
  replay?: number;
  as?: "div" | "ul";
}) {
  const Item = Tag === "ul" ? "li" : "div";
  return (
    <Tag className={className} key={replay}>
      {children.map((c, i) => (
        <Item key={i} className="reveal" style={{ "--i": i } as CSSProperties}>
          {c}
        </Item>
      ))}
    </Tag>
  );
}
