"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { TextareaField, TextField } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "./FormBits";

export type AuthorView = { id: string; name: string; role: string; bio: string; avatar_url: string | null; is_demo: boolean };

type SaveAction = (authorId: string | null, prev: ActionState, fd: FormData) => Promise<ActionState>;

function AuthorForm({ author, save, onDone }: { author: AuthorView | null; save: SaveAction; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await save(author?.id ?? null, prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="form-grid author-form" noValidate key={state.ok ? state.at : "form"}>
      <ActionFeedback state={state} />
      <TextField label="Full name" name="name" required defaultValue={author?.name} placeholder="Dr. Ana Ruiz" error={fe.name} />
      <TextField label="Role" name="role" defaultValue={author?.role} placeholder="Lead dentist" hint="Their real title. Never invent one." error={fe.role} />
      <TextareaField className="span-2" label="Short bio" name="bio" rows={3} defaultValue={author?.bio} hint="Facts the person confirmed. No made-up tenure or credentials." error={fe.bio} />
      <TextField className="span-2" label="Photo address (optional)" name="avatarUrl" type="url" defaultValue={author?.avatar_url ?? ""} placeholder="https://example.com/team/ana.jpg" error={fe.avatarUrl} />
      <div className="form-acts span-2">
        <Button type="submit" variant={author ? "primary" : "secondary"} loading={pending} icon={author ? "check" : "user-plus"}>
          {author ? "Save author" : "Add author"}
        </Button>
        {author && onDone ? (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Bylines for one site: real people only, configured by the client. The
 * generator may use only these and never invents a title, tenure or credential.
 */
export function AuthorsEditor({
  authors,
  canEdit,
  save,
  remove,
}: {
  authors: AuthorView[];
  canEdit: boolean;
  save: SaveAction;
  remove: (authorId: string) => Promise<ActionState>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AuthorView | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className="authors">
      {canEdit ? null : <ReadOnlyNote>Your role can see authors. Editors and owners manage them.</ReadOnlyNote>}
      {authors.length ? (
        <ul className="author-list">
          {authors.map((a) => (
            <li key={a.id} className="panel author">
              {editing === a.id ? (
                <AuthorForm author={a} save={save} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="author-main">
                    {a.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- client-supplied https URL, sized by CSS
                      <img className="author-img" src={a.avatar_url} alt="" width={48} height={48} referrerPolicy="no-referrer" />
                    ) : (
                      <span className="author-img" aria-hidden="true">
                        {a.name
                          .split(/\s+/)
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                    )}
                    <div className="author-text">
                      <p className="author-name">
                        {a.name}
                        {a.is_demo ? (
                          <Badge tone="amber" icon="alert">
                            Demo: replace with a real person
                          </Badge>
                        ) : null}
                      </p>
                      {a.role ? <p className="author-role">{a.role}</p> : null}
                      {a.bio ? <p className="author-bio">{a.bio}</p> : null}
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="author-acts">
                      <Button size="sm" variant="ghost" icon="pen" onClick={() => setEditing(a.id)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirm(a)}>
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel author-empty">
          <span className="feat-ico" aria-hidden="true">
            <Icon name="users" />
          </span>
          <div>
            <p className="author-name">No authors yet</p>
            <p className="muted small">Articles need a real byline. Add the people who will sign them: their name, real role and a short bio.</p>
          </div>
        </div>
      )}
      {canEdit ? (
        <section className="panel author-add" aria-labelledby="add-author-h">
          <h3 id="add-author-h">Add an author</h3>
          <AuthorForm author={null} save={save} />
        </section>
      ) : null}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Remove ${confirm?.name ?? "this author"}?`}
        description="Published articles keep their byline. New articles can no longer use this person."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await remove(confirm!.id);
                  setConfirm(null);
                  toast.push(r.ok ? { tone: "ok", title: r.message ?? "Removed." } : { tone: "danger", title: r.error ?? "Could not remove." });
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}
