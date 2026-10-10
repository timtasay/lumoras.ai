"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Segmented, TextareaField, TextField } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { idle, type ActionState } from "@/lib/actions-state";
import { ActionFeedback, ReadOnlyNote, submitKeepingValues } from "./FormBits";

export type AuthorKind = "person" | "organization";
export type AuthorView = { id: string; kind: AuthorKind; name: string; role: string; bio: string; avatar_url: string | null; is_demo: boolean };

type SaveAction = (authorId: string | null, prev: ActionState, fd: FormData) => Promise<ActionState>;

/** When to use each kind of byline (shown under the selector). */
const KIND_HELP: Record<AuthorKind, string> = {
  person: "A real person who stands behind the article: their name, their real title and a bio they confirmed. Published as schema.org Person. Use it whenever someone signs.",
  organization: "Your organization signs as a team, like \u201cLumoras team\u201d. No job title or credentials: an organization has none. Published as schema.org Organization. Use it when no single person signs.",
};

function AuthorForm({ author, save, onDone }: { author: AuthorView | null; save: SaveAction; onDone?: () => void }) {
  const [kind, setKind] = useState<AuthorKind>(author?.kind ?? "person");
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await save(author?.id ?? null, prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, idle);
  const fe = state.fieldErrors ?? {};
  const org = kind === "organization";
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="form-grid author-form" noValidate key={state.ok ? state.at : "form"}>
      <ActionFeedback state={state} />
      <div className="fld span-2 author-kind">
        <span className="fld-label" id={`kind-${author?.id ?? "new"}`}>
          Byline
        </span>
        <Segmented
          size="sm"
          label="Byline type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "person", label: "A person" },
            { value: "organization", label: "An organization" },
          ]}
        />
        <input type="hidden" name="kind" value={kind} />
        <p className="fld-hint" aria-live="polite">
          {KIND_HELP[kind]}
        </p>
        {fe.kind ? <p className="fld-err">{fe.kind}</p> : null}
      </div>
      <TextField
        key={`n-${kind}`}
        label={org ? "Organization name" : "Full name"}
        name="name"
        required
        defaultValue={author?.name}
        placeholder={org ? "Lumoras team" : "Dr. Ana Ruiz"}
        error={fe.name}
      />
      {org ? (
        <p className="muted small author-org-note">
          <Icon name="building" className="inline-ico" /> No role for an organization byline: titles and credentials belong to people.
        </p>
      ) : (
        <TextField label="Role" name="role" defaultValue={author?.role} placeholder="Lead dentist" hint="Their real title. Never invent one." error={fe.role} />
      )}
      {org && fe.role ? <p className="fld-err span-2">{fe.role}</p> : null}
      <TextareaField
        key={`b-${kind}`}
        className="span-2"
        label={org ? "About (optional)" : "Short bio"}
        name="bio"
        rows={3}
        defaultValue={author?.bio}
        hint={org ? "What the organization does, in facts the client confirmed." : "Facts the person confirmed. No made-up tenure or credentials."}
        error={fe.bio}
      />
      <TextField
        key={`a-${kind}`}
        className="span-2"
        label={org ? "Logo address (optional)" : "Photo address (optional)"}
        name="avatarUrl"
        type="url"
        defaultValue={author?.avatar_url ?? ""}
        placeholder={org ? "https://example.com/logo.png" : "https://example.com/team/ana.jpg"}
        error={fe.avatarUrl}
      />
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
 * Bylines for one site, configured by the client: real people, or the
 * client's organization (owner decision, 10 October 2026). The generator may
 * use only these and never invents a name, title, tenure or credential.
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
                      <span className="author-img" aria-hidden="true" data-org={a.kind === "organization" ? "" : undefined}>
                        {a.kind === "organization" ? <Icon name="building" /> : a.name
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
                        {a.kind === "organization" ? (
                          <Badge tone="info" icon="building">
                            Organization
                          </Badge>
                        ) : null}
                        {a.is_demo ? (
                          <Badge tone="amber" icon="alert">
                            {a.kind === "organization" ? "Demo: replace with the real organization" : "Demo: replace with a real person"}
                          </Badge>
                        ) : null}
                      </p>
                      {a.kind === "organization" ? <p className="author-role">Team byline · published as schema.org Organization</p> : a.role ? <p className="author-role">{a.role}</p> : null}
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
            <p className="muted small">Articles need a real byline. Add the people who will sign them (name, real role, short bio), or your organization if the team signs together.</p>
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
        description={confirm?.kind === "organization" ? "Published articles keep their byline. New articles can no longer use this organization byline." : "Published articles keep their byline. New articles can no longer use this person."}
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
