import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Buildings,
  Check,
  ChatTeardropText,
  Circuitry,
  Cpu,
  Fingerprint,
  FlowArrow,
  Gauge,
  GithubLogo,
  Globe,
  Lightning,
  Lock,
  ShareNetwork,
  ShieldCheck,
  Sparkle,
  Stack,
} from "@phosphor-icons/react/dist/ssr";

import { ThemeToggle } from "@/components/shell/ThemeToggle";

export const metadata = {
  title: "Verity — trustworthy AI orchestration",
  description:
    "Verity orchestrates a fleet of reasoning agents behind a five-layer security spine — confidence-scored answers, durable memory, flows, offices, and a verifiable compute network.",
};

// ---- Small server-side helpers (no client JS; the marketing CSS keeps every
// section fully legible without motion). Icons come from the SSR entrypoint so
// this whole page renders as a server component. --------------------------

const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#security", label: "Security" },
  { href: "#network", label: "Compute" },
  { href: "#pricing", label: "Pricing" },
];

const PLATES = [
  {
    Icon: ChatTeardropText,
    title: "Chat that reasons in the open",
    body: "Every answer streams word-by-word with a live confidence read and its sources. When the model is unsure, it says so — no confident fabrication.",
    tags: ["streaming", "confidence", "citations"],
  },
  {
    Icon: FlowArrow,
    title: "Flows — parallel work, converged",
    body: "Fan a task across specialist workers, then converge. A conductor plans, workers execute, an inspector checks. You watch the whole graph resolve.",
    tags: ["diverge", "converge", "inspect"],
  },
  {
    Icon: Buildings,
    title: "Offices that keep working",
    body: "Standing teams with state checkpoints and schedules. They pick up where they left off, fire on cron, and stay inside per-user caps.",
    tags: ["scheduled", "stateful", "durable"],
  },
  {
    Icon: Brain,
    title: "Memory that compounds",
    body: "A per-user knowledge graph (cognee) learns from every exchange — grounded recall, isolated by tenant, degrading to a durable vault when offline.",
    tags: ["knowledge graph", "grounded", "isolated"],
  },
  {
    Icon: Stack,
    title: "Tools, skills & MCP",
    body: "The model calls real tools — web search, browser fetch, file output, and any MCP server — behind per-tool consent and an SSRF guard.",
    tags: ["tool-use", "MCP", "sandboxed"],
  },
  {
    Icon: ShareNetwork,
    title: "Share a transcript, not your keys",
    body: "Publish a read-only transcript from any conversation. Recipients see the reasoning; they never touch your workspace, memory, or credentials.",
    tags: ["read-only", "shareable", "safe"],
  },
];

const SECURITY = [
  {
    Icon: ShieldCheck,
    title: "L1 — Edge",
    body: "Strict CSP and DOMPurify at the boundary; a WAF fronts the public gateway. Untrusted content is wrapped before it ever reaches a model.",
    mono: "CSP · WAF · sanitise",
  },
  {
    Icon: Lock,
    title: "L2 — Gateway",
    body: "JWT verified against Supabase (JWKS + HS256); per-user token buckets; every request validated. Identity is proven here, not trusted.",
    mono: "JWT · rate-limit · validate",
  },
  {
    Icon: Fingerprint,
    title: "L3 — Identity",
    body: "Tenant identity is injected as gRPC metadata and never read from a request body. A forgotten filter fails to compile — it cannot leak cross-tenant.",
    mono: "metadata-only · fail-closed",
  },
  {
    Icon: Circuitry,
    title: "L4 — Brain",
    body: "A prompt-injection interceptor screens user input; the Blind Orchestration Protocol isolates untrusted text; secrets live in an AES-256-GCM vault.",
    mono: "injection guard · BOP · vault",
  },
  {
    Icon: Cpu,
    title: "L5 — Data",
    body: "The vector store enforces a mandatory tenant filter in Rust, fail-closed, with a cross-tenant CI corpus that proves isolation on every push.",
    mono: "tenant filter · CI-proven",
  },
];

const TIERS = [
  {
    name: "Explore",
    amount: "$0",
    per: "/ forever",
    note: "For trying Verity end-to-end on your own keys.",
    features: [
      "Chat with confidence scoring",
      "Bring your own model keys",
      "Flows & a single office",
      "Local + durable memory",
    ],
    cta: "Start free",
    feature: false,
  },
  {
    name: "Studio",
    amount: "$24",
    per: "/ month",
    note: "For daily work — hosted memory, more parallelism, scheduled offices.",
    features: [
      "Everything in Explore",
      "Hosted cognee knowledge graph",
      "Wide-research & file output",
      "Scheduled, stateful offices",
      "Priority streaming",
    ],
    cta: "Open the app",
    feature: true,
  },
  {
    name: "Network",
    amount: "$0.02",
    per: "/ compute-credit",
    note: "Metered access to the verifiable consensus compute network.",
    features: [
      "Everything in Studio",
      "Redundant multi-node consensus",
      "Server-authoritative metering",
      "Credits ledger & receipts",
    ],
    cta: "Talk to us",
    feature: false,
  },
];

function Brand() {
  return (
    <Link href="/" className="mkt-brand" aria-label="Verity home">
      <span className="mkt-brand__mark">Verity</span>
      <span className="mkt-brand__tag">Orchestration</span>
    </Link>
  );
}

export default function MarketingHome() {
  const heroWords = "Answers you can put your name on.".split(" ");

  return (
    <div className="mkt">
      {/* Fixed nav. The scrolled state is a progressive enhancement; the glass
          panel simply always reads as glass here. */}
      <header className="mkt-nav mkt-nav--scrolled">
        <div className="mkt-nav__inner glass">
          <Brand />
          <nav className="mkt-nav__links" aria-label="Sections">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="mkt-nav__link">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mkt-nav__right">
            <ThemeToggle />
            <Link href="/app" className="mkt-btn mkt-btn--primary mkt-btn--sm">
              Open app
              <ArrowRight size={16} weight="bold" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---- Hero ---- */}
        <section className="mkt-section hero">
          <div className="mkt-wrap">
            <div className="hero__grid">
              <div>
                <span className="mkt-eyebrow">Multi-agent, verifiable</span>
                <h1 className="hero__title">
                  {heroWords.map((w, i) => (
                    <span
                      key={i}
                      className={`word${i === heroWords.length - 1 ? " accent" : ""}`}
                    >
                      {w}
                    </span>
                  ))}
                </h1>
                <p className="hero__lede">
                  Verity orchestrates a fleet of reasoning agents behind a
                  five-layer security spine. Every answer is confidence-scored,
                  grounded, and traceable — calm, precise, and yours.
                </p>
                <div className="hero__actions">
                  <Link href="/app" className="mkt-btn mkt-btn--primary">
                    Open the app
                    <ArrowRight size={18} weight="bold" />
                  </Link>
                  <a
                    href="https://github.com/electric13k/Verity"
                    className="mkt-btn mkt-btn--ghost"
                  >
                    <GithubLogo size={18} weight="fill" />
                    Source
                  </a>
                </div>
                <div className="hero__meta">
                  <div className="hero__meta-item">
                    <span className="hero__meta-k">5</span>
                    <span className="hero__meta-v">security layers</span>
                  </div>
                  <div className="hero__meta-item">
                    <span className="hero__meta-k">4</span>
                    <span className="hero__meta-v">language stack</span>
                  </div>
                  <div className="hero__meta-item">
                    <span className="hero__meta-k">0</span>
                    <span className="hero__meta-v">cross-tenant leaks</span>
                  </div>
                </div>
              </div>

              {/* Specimen: a static confidence read card. */}
              <div className="hero__specimen">
                <article className="spec-card glass">
                  <div className="spec-card__head">
                    <div className="spec-card__role">
                      <span className="spec-card__avatar">
                        <Sparkle size={16} weight="fill" />
                      </span>
                      <div>
                        <div className="spec-card__name">Verity</div>
                        <div className="spec-card__sub">Conductor · 4 workers</div>
                      </div>
                    </div>
                    <Gauge size={20} weight="regular" />
                  </div>
                  <p className="spec-card__body">
                    Consensus across four workers holds. Two sources agree on the
                    figure; one is stale and was down-weighted. I&apos;ve flagged
                    the assumption so you can check it.
                  </p>
                  <div className="spec-card__conf">
                    <span className="spec-card__label">Confidence</span>
                    <span className="spec-meter">
                      <span
                        className="spec-meter__fill"
                        style={{ width: "94%" }}
                      />
                    </span>
                    <span className="spec-card__pct">94%</span>
                  </div>
                </article>
              </div>
            </div>
          </div>
          <div className="hero__cue" aria-hidden>
            <span>Scroll</span>
          </div>
        </section>

        {/* ---- Principles marquee ---- */}
        <section className="mkt-section" aria-label="Principles">
          <div className="marquee">
            <div className="marquee__track">
              {[
                "Boot degrades, never dies",
                "Identity is proven, not trusted",
                "Confidence over confidence-theatre",
                "Fail closed",
                "Your keys, your memory",
                "Untrusted text stays untrusted",
                "Boot degrades, never dies",
                "Identity is proven, not trusted",
                "Confidence over confidence-theatre",
                "Fail closed",
                "Your keys, your memory",
                "Untrusted text stays untrusted",
              ].map((t, i) => (
                <span key={i} className="marquee__item">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Capabilities ---- */}
        <section className="mkt-section" id="capabilities">
          <div className="mkt-wrap">
            <div className="showcase__head">
              <span className="mkt-eyebrow">What it does</span>
              <h2 className="mkt-h2">
                One workspace for <em className="mkt-em">reasoning at scale</em>.
              </h2>
              <p className="mkt-lede">
                Chat, flows, and offices share the same memory, the same tools,
                and the same security spine — so work moves between them without
                losing context or trust.
              </p>
            </div>
            <div className="showcase__plates">
              {PLATES.map(({ Icon, title, body, tags }, i) => (
                <article key={title} className="plate glass">
                  <div className="plate__no">
                    <b>{String(i + 1).padStart(2, "0")}</b>
                  </div>
                  <div>
                    <div className="plate__head">
                      <span className="plate__ic">
                        <Icon size={22} weight="regular" />
                      </span>
                      <h3 className="plate__title">{title}</h3>
                    </div>
                    <p className="plate__body">{body}</p>
                    <div className="plate__tags">
                      {tags.map((t) => (
                        <span key={t} className="plate__tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Security ---- */}
        <section className="mkt-section" id="security">
          <div className="mkt-wrap">
            <span className="mkt-eyebrow">Security by construction</span>
            <h2 className="mkt-h2">
              Five layers, each <em className="mkt-em">fail-closed</em>.
            </h2>
            <p className="mkt-lede">
              Tenant isolation isn&apos;t a policy you remember to apply — it&apos;s
              a shape the code takes, verified on every push.
            </p>
            <div className="sec-grid">
              {SECURITY.map(({ Icon, title, body, mono }) => (
                <article key={title} className="sec-card glass">
                  <span className="sec-card__ic">
                    <Icon size={26} weight="regular" />
                  </span>
                  <h3 className="sec-card__title">{title}</h3>
                  <p className="sec-card__body">{body}</p>
                  <span className="sec-card__mono">{mono}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Confidence highlight ---- */}
        <section className="mkt-section">
          <div className="mkt-wrap">
            <div className="conf">
              <div>
                <span className="mkt-eyebrow">Calibrated, not confident</span>
                <h2 className="mkt-h2">
                  A number you can <em className="mkt-em">act on</em>.
                </h2>
                <p className="mkt-lede">
                  Verity scores every answer and shows its work. High confidence
                  earns your trust; low confidence earns a second look — before
                  you ship, not after.
                </p>
                <div className="conf-bands">
                  <div className="conf-band">
                    <span
                      className="conf-band__dot"
                      style={{ background: "var(--v-matcha)" }}
                    />
                    High — consensus holds, sources agree
                  </div>
                  <div className="conf-band">
                    <span
                      className="conf-band__dot"
                      style={{ background: "var(--v-chai)" }}
                    />
                    Mixed — a caveat is flagged inline
                  </div>
                  <div className="conf-band">
                    <span
                      className="conf-band__dot"
                      style={{ background: "var(--v-brass)" }}
                    />
                    Low — it says so, and asks
                  </div>
                </div>
              </div>
              <div className="conf-dial glass">
                <svg viewBox="0 0 220 220" role="img" aria-label="94 percent confidence">
                  <circle className="conf-dial__ring-bg" cx="110" cy="110" r="92" />
                  <circle
                    className="conf-dial__ring"
                    cx="110"
                    cy="110"
                    r="92"
                    strokeDasharray="543 578"
                    transform="rotate(-90 110 110)"
                  />
                  <text
                    className="conf-dial__num"
                    x="110"
                    y="112"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    94
                  </text>
                  <text
                    className="conf-dial__lbl"
                    x="110"
                    y="146"
                    textAnchor="middle"
                  >
                    CONFIDENCE
                  </text>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Compute network ---- */}
        <section className="mkt-section" id="network">
          <div className="mkt-wrap">
            <div className="net">
              <div>
                <span className="mkt-eyebrow">Verifiable compute</span>
                <h2 className="mkt-h2">
                  Answers checked by <em className="mkt-em">more than one node</em>.
                </h2>
                <p className="mkt-lede">
                  The compute network runs redundant nodes and takes consensus,
                  with a sybil-pair guard and a credits ledger. Trust is earned by
                  agreement, metered honestly, and recorded.
                </p>
                <div className="net-stats">
                  <div className="stat">
                    <div className="stat__k">×2</div>
                    <div className="stat__v">redundancy</div>
                  </div>
                  <div className="stat">
                    <div className="stat__k">Rust</div>
                    <div className="stat__v">node daemon</div>
                  </div>
                  <div className="stat">
                    <div className="stat__k">Ledger</div>
                    <div className="stat__v">every credit</div>
                  </div>
                </div>
              </div>
              <div className="net-stage glass">
                <svg viewBox="0 0 320 240" role="img" aria-label="Consensus network diagram">
                  <g className="glyph">
                    <circle cx="160" cy="46" r="18" className="fillm" />
                    <circle cx="160" cy="46" r="18" className="stroke" />
                    <circle cx="60" cy="150" r="16" className="fillc" />
                    <circle cx="60" cy="150" r="16" className="stroke-2" />
                    <circle cx="160" cy="182" r="16" className="fillc" />
                    <circle cx="160" cy="182" r="16" className="stroke-2" />
                    <circle cx="260" cy="150" r="16" className="fillc" />
                    <circle cx="260" cy="150" r="16" className="stroke-2" />
                    <path className="stroke" d="M160 64 L60 150" />
                    <path className="stroke" d="M160 64 L160 182" />
                    <path className="stroke" d="M160 64 L260 150" />
                    <path className="stroke-2" d="M60 150 L160 182" />
                    <path className="stroke-2" d="M160 182 L260 150" />
                    <circle cx="160" cy="46" r="5" className="dot" />
                    <circle cx="60" cy="150" r="4" className="dot" />
                    <circle cx="160" cy="182" r="4" className="dot" />
                    <circle cx="260" cy="150" r="4" className="dot" />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Pricing ---- */}
        <section className="mkt-section" id="pricing">
          <div className="mkt-wrap">
            <span className="mkt-eyebrow">Pricing</span>
            <h2 className="mkt-h2">
              Start free. <em className="mkt-em">Meter honestly.</em>
            </h2>
            <p className="mkt-lede">
              Usage is enforced server-side — entitlements and metering live in
              the gateway, not the browser. No client can grant itself credit.
            </p>
            <div className="tier-grid">
              {TIERS.map((t) => (
                <article
                  key={t.name}
                  className={`tier glass${t.feature ? " tier--feature" : ""}`}
                >
                  {t.feature && <span className="tier__badge">Most popular</span>}
                  <div className="tier__name">{t.name}</div>
                  <div className="tier__price">
                    <span className="tier__amount">{t.amount}</span>
                    <span className="tier__per">{t.per}</span>
                  </div>
                  <p className="tier__note">{t.note}</p>
                  <ul className="tier__list">
                    {t.features.map((f) => (
                      <li key={f}>
                        <Check size={16} weight="bold" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="tier__cta">
                    <Link
                      href="/app"
                      className={`mkt-btn ${t.feature ? "mkt-btn--primary" : "mkt-btn--ghost"}`}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      {t.cta}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---- CTA band ---- */}
        <section className="mkt-section">
          <div className="mkt-wrap">
            <div className="cta-band glass">
              <h2 className="cta-band__title">
                Put your name on the answer.
              </h2>
              <p className="cta-band__lede">
                Open Verity, connect a model, and watch a fleet of agents reason
                in the open — scored, sourced, and secure.
              </p>
              <div className="cta-band__actions">
                <Link href="/app" className="mkt-btn mkt-btn--primary">
                  Open the app
                  <ArrowRight size={18} weight="bold" />
                </Link>
                <a href="#capabilities" className="mkt-btn mkt-btn--ghost">
                  See capabilities
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="mkt-footer">
        <div className="mkt-wrap">
          <div className="mkt-footer__grid">
            <div className="mkt-footer__brand">
              <Brand />
              <p className="mkt-footer__blurb">
                Calm, precise, trustworthy AI orchestration. Multi-agent
                reasoning behind a five-layer security spine.
              </p>
            </div>
            <div className="mkt-footer__col">
              <h4>Product</h4>
              <a href="#capabilities">Capabilities</a>
              <a href="#security">Security</a>
              <a href="#network">Compute</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="mkt-footer__col">
              <h4>App</h4>
              <Link href="/app">Chat</Link>
              <Link href="/app/flows">Flows</Link>
              <Link href="/app/offices">Offices</Link>
              <Link href="/app/compute">Compute</Link>
            </div>
            <div className="mkt-footer__col">
              <h4>More</h4>
              <a href="https://github.com/electric13k/Verity">
                <span
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <GithubLogo size={14} weight="fill" />
                  Source
                </span>
              </a>
              <Link href="/app/settings">Settings</Link>
            </div>
          </div>
          <div className="mkt-footer__base">
            <span>© {new Date().getFullYear()} Verity</span>
            <span>Boot degrades, never dies.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
