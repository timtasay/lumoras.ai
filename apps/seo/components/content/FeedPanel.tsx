"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Switch } from "@/components/ui/Fields";
import { useToast } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/actions-state";

/**
 * The public feeds (JSON Feed 1.1 and RSS 2.0) of a site's published
 * articles. The address carries an unguessable token, so a client can hand it
 * to their own site or newsletter tool; turning the feed off stops it at once.
 */
export function FeedPanel({ enabled, jsonUrl, rssUrl, canEdit, toggle }: { enabled: boolean; jsonUrl: string; rssUrl: string; canEdit: boolean; toggle: (on: boolean) => Promise<ActionState> }) {
  const [on, setOn] = useState(enabled);
  const [, start] = useTransition();
  const toast = useToast();
  return (
    <div className="feed-panel">
      <Switch
        label="Public feed of published articles"
        hint="For sites that pull new posts instead of receiving them. Only published articles appear."
        checked={on}
        disabled={!canEdit}
        onChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await toggle(next);
            if (!r.ok) setOn(!next);
            toast.push(r.ok ? { tone: "ok", title: r.message ?? "Saved." } : { tone: "danger", title: r.error ?? "Could not save." });
          });
        }}
      />
      {on ? (
        <dl className="kv feed-urls">
          <div>
            <dt>JSON Feed</dt>
            <dd className="mono">
              <a className="tlink" href={jsonUrl} target="_blank" rel="noopener noreferrer">
                {jsonUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>RSS</dt>
            <dd className="mono">
              <a className="tlink" href={rssUrl} target="_blank" rel="noopener noreferrer">
                {rssUrl}
              </a>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="small muted">
          <Icon name="lock" className="inline-ico" /> The feed is off: its address answers 404.
        </p>
      )}
    </div>
  );
}
