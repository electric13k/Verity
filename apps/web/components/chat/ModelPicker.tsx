"use client";

import { CaretUpDown, Check, Sparkle, Warning } from "@phosphor-icons/react";
import { Menu, MenuItem } from "@/components/glass/Menu";
import { useApp } from "@/lib/store";

// Provider/model picker. Labels come from the model catalog; /me decides which
// providers are actually configured. Unconfigured keyed providers stay
// selectable but are flagged — selecting one surfaces a real gateway error,
// which is honest UX for "you haven't added that key yet".

export function ModelPicker() {
  const { models, selector, setSelector, me } = useApp();
  const current = models.find((m) => m.selector === selector) ?? models[0];

  const configured = (provider: string): boolean => {
    const p = me?.providers.find((x) => x.id === provider || (provider === "verity" && x.house));
    return p?.configured ?? provider === "verity";
  };

  return (
    <Menu
      side="top"
      align="start"
      trigger={({ toggle, open, id }) => (
        <button
          type="button"
          className="gchip"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
        >
          <Sparkle size={13} weight="fill" style={{ color: "var(--v-chai)" }} />
          {current?.label ?? "Model"}
          <CaretUpDown size={12} style={{ opacity: 0.6 }} />
        </button>
      )}
    >
      {(close) =>
        models.map((m) => {
          const ok = configured(m.provider);
          return (
            <MenuItem
              key={m.selector}
              active={m.selector === selector}
              icon={m.selector === selector ? <Check size={15} weight="bold" /> : <span style={{ width: 15 }} />}
              hint={!ok ? <Warning size={13} style={{ color: "var(--v-chai)" }} /> : undefined}
              onClick={() => {
                setSelector(m.selector);
                close();
              }}
            >
              {m.label}
            </MenuItem>
          );
        })
      }
    </Menu>
  );
}
