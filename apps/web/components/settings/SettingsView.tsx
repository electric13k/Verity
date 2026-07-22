"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, ShieldCheck } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { api } from "@/lib/api/client";
import { IS_MOCK } from "@/lib/api/config";
import { optimistic } from "@/lib/optimistic";
import { useApp } from "@/lib/store";
import type { ProviderKeyInfo } from "@/lib/api/types";
import { ProviderKeyRow } from "./ProviderKeyRow";

// Settings — provider keys. Bring your own key for any provider, or lean on
// Verity's house models. Keys go to the gateway vault (PUT/DELETE); the client
// only ever learns whether a provider is configured, never the material.

export function SettingsView() {
  const [keys, setKeys] = useState<ProviderKeyInfo[] | null>(null);
  const { notify } = useApp();

  const refresh = useCallback(() => {
    api.getProviderKeys().then(setKeys);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Flip the row to "Configured" the instant the key is sent — the material
  // itself is never held here, only the fact that a key now exists. If the vault
  // rejects it, the row falls back to "Not set" and a quiet notice explains.
  const setConfigured = (provider: string, configured: boolean) =>
    setKeys((prev) =>
      prev ? prev.map((k) => (k.id === provider ? { ...k, configured } : k)) : prev,
    );

  const save = useCallback(async (provider: string, key: string) => {
    await optimistic({
      apply: () => setConfigured(provider, true),
      commit: () => api.putProviderKey(provider, key),
      reconcile: () => refresh(),
      rollback: () => setConfigured(provider, false),
      onError: () => notify("Couldn't save that key. Nothing was stored."),
    });
  }, [refresh, notify]);

  const remove = useCallback(async (provider: string) => {
    await optimistic({
      apply: () => setConfigured(provider, false),
      commit: () => api.deleteProviderKey(provider),
      reconcile: () => refresh(),
      rollback: () => setConfigured(provider, true),
      onError: () => notify("Couldn't remove that key. It's still configured."),
    });
  }, [refresh, notify]);

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Settings · Provider keys</span>
          <h1 className="flow__title font-display">Your keys, or ours.</h1>
        </div>
        <span
          className="chat__note"
          title={
            IS_MOCK
              ? "Key storage is served by the in-memory mock. The real vault is AES-256-GCM at the gateway; the client never sees key material."
              : "Keys are stored in the gateway vault (AES-256-GCM). The client only ever learns whether a provider is configured, never the material."
          }
        >
          <Info size={13} />
          {IS_MOCK ? "Mock vault" : "Vault"}
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
