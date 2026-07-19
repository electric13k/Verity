"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, ShieldCheck } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { api } from "@/lib/api/client";
import type { ProviderKeyInfo } from "@/lib/api/types";
import { ProviderKeyRow } from "./ProviderKeyRow";

// Settings — provider keys. Bring your own key for any provider, or lean on
// Verity's house models. Keys go to the gateway vault (PUT/DELETE); the client
// only ever learns whether a provider is configured, never the material.

export function SettingsView() {
  const [keys, setKeys] = useState<ProviderKeyInfo[] | null>(null);

  const refresh = useCallback(() => {
    api.getProviderKeys().then(setKeys);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (provider: string, key: string) => {
    await api.putProviderKey(provider, key);
    refresh();
  }, [refresh]);

  const remove = useCallback(async (provider: string) => {
    await api.deleteProviderKey(provider);
    refresh();
  }, [refresh]);

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Settings · Provider keys</span>
          <h1 className="flow__title font-display">Your keys, or ours.</h1>
        </div>
        <span className="chat__note" title="Key storage is served by the in-memory mock (API_SURFACE: planned). The vault is AES-256-GCM at the gateway; the client never sees key material.">
          <Info size={13} />
          Mock vault
        </span>
      </header>

      <div className="flow__body scroll-quiet">
        <div className="flow__inner settings">
          <Panel raised className="settings-note">
            <ShieldCheck size={18} weight="regular" style={{ color: "var(--v-matcha)", flex: "none" }} />
            <p>
              Keys are encrypted at the gateway and used only to reach that provider on your behalf. They are never
              returned to the browser and never leave with a transcript or share.
            </p>
          </Panel>

          <div className="settings-section">
            <span className="eyebrow">Providers</span>
            {keys === null ? (
              <div className="think-dots" aria-label="Loading"><span /><span /><span /></div>
            ) : (
              <div className="key-list">
                {keys.map((k) => (
                  <ProviderKeyRow key={k.id} info={k} onSave={save} onRemove={remove} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
