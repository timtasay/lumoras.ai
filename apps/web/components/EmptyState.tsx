import Link from "next/link";

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty panel">
      <p className="empty-title">{title}</p>
      <p>{text}</p>
      <p>
        <Link href="/" className="tlink">Back to the homepage</Link>
      </p>
    </div>
  );
}
