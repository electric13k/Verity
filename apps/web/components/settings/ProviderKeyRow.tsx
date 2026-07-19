"use client";

import { useState } from "react";
import { CheckCircle, Sparkle, TrashSimple, Eye, EyeSlash } from "@phosphor-icons/react";
import { Input } from "@/components/glass/Field";
import { Button } from "@/components/glass/Button";
import { Badge } from "@/components/glass/Chip";
import type { ProviderKeyInfo } from "@/lib/api/types";

// One provider's key row. Key material is write-only: once entered it is sent
// to the vault (PUT) and never read back — the row only ever shows whether a
// key is configured. House providers ("provided by Verity") carry no key entry.

export function ProviderKeyRow({
  info,
  onSave,
  onRemove,
}: {
  info: ProviderKeyInfo;
  onSave: (provider: string, key: string) => Promise<void>;
  onRemove: (provider: string) => Promise<void>;
}) {
  const [entry, setEntry] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const save = async () => {
    if (!entry.trim() || saving) return;
    setSaving(true);
    await onSave(info.id, entry.trim());
    setEntry(""); // never keep the material around
    setReveal(false);
    setEditing(false);
    setSaving(false);
  };

  return (
    <div className="key-row">
      <div className="key-row__head">
        <div className="key-row__id">
          <span className="key-row__name">{info.label}</span>
          {info.house ? (
            <Badge dot="var(--v-chai)">
              <Sparkle size={11} weight="fill" />
              Provided by Verity
            </Badge>
          ) : info.configured ? (
            <Badge dot="var(--v-matcha)">
              <CheckCircle size={11} weight="fill" />
              Configured
            </Badge>
          ) : (
            <Badge dot="var(--v-fog)">Not set</Badge>
          )}
        </div>

        {!info.house && info.configured && !editing && (
          <div className="key-row__actions">
            <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>Replace</Button>
            <button
              type="button"
              className="office-card__del"
              aria-label={`Remove ${info.label} key`}
              onClick={() => onRemove(info.id)}
            >
              <TrashSimple size={15} />
            </button>
          </div>
        )}
      </div>

      {info.house ? (
        <p className="key-row__note">
          Verity’s house models need no key — usage draws on your credits.
        </p>
      ) : (!info.configured || editing) ? (
        <div className="key-row__entry">
          <div className="key-row__field">
            <Input
              type={reveal ? "text" : "password"}
              value={entry}
              placeholder={`Paste your ${info.label} API key`}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
              aria-label={`${info.label} API key`}
            />
            <button
              type="button"
              className="key-row__reveal"
              aria-label={reveal ? "Hide key" : "Show key"}
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? <EyeSlash size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <div className="key-row__save">
            {editing && (
              <Button size="sm" variant="quiet" onClick={() => { setEntry(""); setEditing(false); }}>Cancel</Button>
            )}
            <Button size="sm" variant="primary" onClick={save} disabled={!entry.trim() || saving}>
              {saving ? "Saving…" : "Save key"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="key-row__note">Stored encrypted (AES-256-GCM). The key is never shown again.</p>
      )}
    </div>
  );
}
