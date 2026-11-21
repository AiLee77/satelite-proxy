import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./ChainPage.css";
import {
  checkExitIp,
  createChain,
  createPool,
  deleteChain,
  deletePool,
  diagnoseChain,
  exportChainMihomoYaml,
  activateSubscription,
  exportChainText,
  generateSingboxConfig,
  getProxyStatus,
  getSettings,
  deactivateChainExit as deactivateChainExitCmd,
  listChainNodes,
  listChains,
  listSubscriptions,
  listPools,
  onProxySnapshot,
  peekSettings,
  renameChainAuto,
  setCurrentNode,
  updateChain,
  updatePool,
} from "../api";
import { chainVirtualNodeId } from "../chainVirtualNode";
import { groupNodes, type NodeGroup } from "../nodeGroups";
import { waitForCoreRestart } from "../coreBusy";
import { copyNodeShareText } from "../nodeShare";
import { GlassButton } from "../components/GlassButton";
import { GlassSeg } from "../components/GlassSeg";
import { ErrorModal } from "../components/ErrorModal";
import { useI18n } from "../i18n";
import {
  chainHasDeadHop,
  chainPoolPreviewMembers,
  enabledUniverse,
  parseKeywords,
  poolKeywordMatch,
} from "../chainNodeUniverse";
import type {
  ChainDiagnosis,
  ChainHop,
  ExitIpInfo,
  NodePool,
  PoolMode,
  ProxyChain,
  ProxyNode,
  SubscriptionView,
} from "../types";

/** Display label for one hop, resolved against the current node/pool lists
 *  (plain name — pool-ness is conveyed by the caller's glyph). */
function hopLabel(
  hop: ChainHop,
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
): { text: string; stale: boolean } {
  if (hop.kind === "node") {
    const n = nodeById.get(hop.node_id);
    return n ? { text: n.name, stale: false } : { text: hop.node_id, stale: true };
  }
  const p = poolById.get(hop.pool_id);
  return p ? { text: p.name, stale: false } : { text: hop.pool_id, stale: true };
}

/** Auto-name label for a whole chain ("A → B → C") — the SAME derivation
 *  the editor's live auto-name uses (hop labels in hop order joined with
 *  " → "), so an auto-named chain stays spelt identically on the card, in
 *  the editor field, and after the mount-time rename sync. Truncated to
 *  the 64-char backend limit here; the backend re-checks either way. */
function chainAutoLabel(
  hops: ChainHop[],
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
): string {
  return hops
    .map((h) => hopLabel(h, nodeById, poolById).text)
    .join(" → ")
    .slice(0, 64);
}

/** I4: the subscriptions a chain's hops resolve to — activating a chain
 *  auto-enables any of them that are still disabled through the existing
 *  subscription activation path (MIX toggle-on included). Dead references
 *  are skipped here: the backend liveness check in `select_chain_exit` is
 *  the authority for hop errors. Keyword pools match the enabled-only
 *  universe by design, so they can never *require* a disabled subscription;
 *  subscription pools pin their target subscription even when its member
 *  list is currently empty. */
function requiredSubscriptionIds(
  chain: ProxyChain,
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
): Set<string> {
  const required = new Set<string>();
  for (const hop of chain.hops) {
    if (hop.kind === "node") {
      const sub = nodeById.get(hop.node_id)?.subscription_id;
      if (sub) required.add(sub);
    } else {
      const pool = poolById.get(hop.pool_id);
      if (!pool) continue;
      if (pool.mode.mode === "subscription") {
        required.add(pool.mode.subscription_id);
      } else if (pool.mode.mode === "explicit") {
        for (const id of pool.mode.node_ids) {
          const sub = nodeById.get(id)?.subscription_id;
          if (sub) required.add(sub);
        }
      }
      // keyword 池只匹配启用宇宙——收集不到任何“被禁用却被需要”的订阅。
    }
  }
  return required;
}

/** Mount-time name-follow sync: auto-named chains (name_manual === false,
 *  never hand-edited) get their "A → B" label re-derived from the hops'
 *  CURRENT node/pool names — a hop renamed in the NodesPage shows up on the
 *  chain card without reopening the editor. All rewrites go through the
 *  backend's rename_chain_auto (manual names, would-be duplicates and
 *  empty results are no-ops there); chains with a stale hop keep their last
 *  good name — regressing to a raw-id label would read worse. Best-effort:
 *  any failure leaves the old name in place. */
async function syncAutoChainNames(
  list: ProxyChain[],
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
): Promise<ProxyChain[]> {
  let next: ProxyChain[] | null = null;
  for (let i = 0; i < list.length; i++) {
    const chain = list[i];
    if (chain.name_manual !== false) continue;
    if (chain.hops.some((h) => hopLabel(h, nodeById, poolById).stale)) continue;
    const label = chainAutoLabel(chain.hops, nodeById, poolById);
    if (!label || label === chain.name) continue;
    try {
      const updated = await renameChainAuto(chain.id, label);
      if (updated) {
        if (!next) next = [...list];
        next[i] = updated;
      }
    } catch {
      /* rename is best-effort — keep the old name on any failure */
    }
  }
  return next ?? list;
}

/** Country code → localized region name — same recipe as the dashboard's
 *  exit-IP card (HK/TW use the Chinese-specific labels everywhere but en). */
function countryDisplayName(cc: string, locale: string): string {
  const code = cc.toUpperCase();
  if (locale !== "en" && code === "HK") return "中国香港";
  if (locale !== "en" && code === "TW") return "中国台湾";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) || cc;
  } catch {
    return cc;
  }
}

/** Client-side mirror of a keyword pool's include/exclude name filter —
 *  display-only (dot count preview); the backend re-evaluates at build time
 *  against the same enabled-only universe (see ../chainNodeUniverse). */

/** Vector glyph marking node pools (layers/stack = a reusable collection).
 *  Replaces the 📦 emoji: emoji fonts vary per platform and can't be themed;
 *  this renders identically everywhere and follows color via currentColor. */
function PoolGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.8 14 5 8 8.2 2 5Z" />
      <path d="m2 8.2 6 3.2 6-3.2" />
      <path d="m2 11.4 6 3.2 6-3.2" />
    </svg>
  );
}

/** Monochrome pulse mark for the card-face diagnose button — same stroke
    idiom as PoolGlyph (currentColor, never emoji fallback colours). */
function DiagGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8h3L6.4 3.8 9 12.2 10.6 8h3.9" />
    </svg>
  );
}

const MAX_POOL_DOTS = 12;

/** Middle-ellipsis node/pool names that keep the TAIL — subscription node
 *  names differ mostly in their suffix ("…香港 IEPL 03"), so the tail is
 *  what tells two rows apart; the middle is the only thing allowed to
 *  give way. Long names split into head + tail spans: when the row has
 *  room both spans render whole (no ellipsis), when squeezed only the
 *  head ellipsizes and the tail stays pinned. The full text is meant for
 *  the row's `title` (hover) — the caller owns it so it can append the
 *  subscription/status hints there. */
function EllipsisTail({ text }: { text: string }) {
  if (text.length <= 24) return <span className="chain-item-name">{text}</span>;
  return (
    <span className="chain-item-name">
      <span className="chain-item-head">{text.slice(0, text.length - 12)}</span>
      <span className="chain-item-tail">{text.slice(-12)}</span>
    </span>
  );
}

/** Rich card payload for one hop, computed once when the hop is placed on
 *  the canvas (order badges are merged in live by the editor). Single nodes
 *  show protocol + last-known latency; pools show a member dot grid + count.
 *  `keywordNodes` is the enabled-subscription universe — keyword pool
 *  previews mirror runtime semantics, while explicit pools keep showing
 *  members from disabled subscriptions (node-ID references, any sub). */
function hopCardData(
  hop: ChainHop,
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
  keywordNodes: ProxyNode[],
): Record<string, unknown> {
  if (hop.kind === "node") {
    const n = nodeById.get(hop.node_id);
    return n
      ? {
          kind: "node",
          label: n.name,
          stale: false,
          protocol: n.protocol,
          latencyMs: n.latency_ms ?? null,
        }
      : { kind: "node", label: hop.node_id, stale: true };
  }
  const p = poolById.get(hop.pool_id);
  if (!p) return { kind: "pool", label: hop.pool_id, stale: true };
  if (p.mode.mode === "explicit") {
    const ids = p.mode.node_ids;
    return {
      kind: "pool",
      label: p.name,
      stale: false,
      poolMode: "explicit" as const,
      memberCount: ids.length,
      dots: ids.slice(0, MAX_POOL_DOTS).map((id) => nodeById.has(id)),
      overflow: Math.max(0, ids.length - MAX_POOL_DOTS),
    };
  }
  if (p.mode.mode === "subscription") {
    // Whole-subscription pools resolve dynamically at build time against that
    // subscription's enabled universe; the dot grid mirrors the same live
    // preview (store order, no latency sorting — mirrors the Rust arm).
    const subId = p.mode.subscription_id;
    const matched = enabledUniverse(keywordNodes).filter(
      (n) => (n.subscription_id ?? "") === subId,
    );
    return {
      kind: "pool",
      label: p.name,
      stale: false,
      poolMode: "subscription" as const,
      memberCount: matched.length,
      dots: matched.slice(0, MAX_POOL_DOTS).map(() => true),
      overflow: Math.max(0, matched.length - MAX_POOL_DOTS),
      subscriptionId: p.mode.subscription_id,
    };
  }
  const { include, exclude } = p.mode;
  const matched = enabledUniverse(keywordNodes).filter((n) =>
    poolKeywordMatch(n.name, include, exclude),
  );
  return {
    kind: "pool",
    label: p.name,
    stale: false,
    poolMode: "keyword" as const,
    memberCount: matched.length,
    dots: matched.slice(0, MAX_POOL_DOTS).map(() => true),
    overflow: Math.max(0, matched.length - MAX_POOL_DOTS),
    include,
    exclude,
  };
}

/** Custom flow nodes, network-console style. Single nodes are compact entity
 *  cards (name · protocol · last-known latency); pools are one-size-bigger
 *  aggregate cards (member dot grid, count, mode subtitle). The 1px topline
 *  marks the chain role (green = entry/client side, blue = exit/internet
 *  side). Handles stay hidden until hover/connection drag (see App.css).
 *  `data.index`/`data.total` carry the live graph-derived order (null while
 *  the graph isn't a valid single path). */
function HopNode({ data }: NodeProps) {
  const { t } = useI18n();
  const label = data.label as string;
  const stale = data.stale as boolean;
  const index = (data.index as number | null | undefined) ?? null;
  const total = (data.total as number | null | undefined) ?? null;
  const kind = (data.kind as "node" | "pool" | undefined) ?? "node";
  const role =
    index == null || total == null || total < 2
      ? null
      : index === 1
        ? "entry"
        : index === total
          ? "exit"
          : null;

  let sub: React.ReactNode;
  if (stale) {
    sub = <span className="chain-hop-sub">{t("rules.nodeStale")}</span>;
  } else if (kind === "pool") {
    const poolMode = data.poolMode as "explicit" | "keyword" | "subscription" | undefined;
    const memberCount = (data.memberCount as number | undefined) ?? 0;
    const include = (data.include as string[] | undefined) ?? [];
    const exclude = (data.exclude as string[] | undefined) ?? [];
    const kws = [...include.map((k) => `+${k}`), ...exclude.map((k) => `−${k}`)].join(" ");
    const modeText =
      poolMode === "keyword"
        ? kws || t("chain.poolKeywordAll")
        : poolMode === "subscription"
          ? t("chain.poolModeSubscription")
          : t("chain.poolModeExplicit");
    sub = (
      <span className="chain-hop-sub">
        {poolMode === "explicit" ? (
          <span className="pill target-node chain-hop-explicit-pill">{modeText}</span>
        ) : modeText}
        {memberCount > 0 && ` · ${memberCount} ${t("chain.poolMembersSuffix")}`}
      </span>
    );
  } else {
    const protocol = data.protocol as string | undefined;
    const latencyMs = data.latencyMs as number | null | undefined;
    sub = (
      <span className="chain-hop-sub">
        {protocol ? protocol.toUpperCase() : ""}
        {latencyMs != null && latencyMs > 0 && (
          <span className="chain-hop-latency">{latencyMs} ms</span>
        )}
      </span>
    );
  }

  const dots = (data.dots as boolean[] | undefined) ?? [];
  const overflow = (data.overflow as number | undefined) ?? 0;

  return (
    <div
      className={`chain-hop-node ${kind === "pool" ? "pool-card" : "node-card"}${
        stale ? " stale" : ""
      }${role ? ` ${role}` : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectableStart={false} />
      <div className="chain-hop-head">
        {kind === "pool" && (
          <span className="chain-hop-glyph" aria-hidden="true">
            <PoolGlyph />
          </span>
        )}
        <span className="chain-hop-name" title={label}>
          {label}
        </span>
        {index != null && (
          <span
            className="chain-hop-badge"
            title={
              role === "entry"
                ? t("chain.entryHop")
                : role === "exit"
                  ? t("chain.exitHop")
                  : undefined
            }
          >
            {index}
          </span>
        )}
      </div>
      {kind === "pool" && !stale && dots.length > 0 && (
        <div className="chain-hop-members" aria-hidden="true">
          {dots.map((ok, i) => (
            <span key={i} className={`chain-hop-dot${ok ? "" : " miss"}`} />
          ))}
          {overflow > 0 && <span className="chain-hop-overflow">+{overflow}</span>}
        </div>
      )}
      {sub}
      <Handle type="source" position={Position.Right} isConnectableEnd={false} />
    </div>
  );
}

const nodeTypes = { hop: HopNode };

/** Walk the graph from whichever node has no incoming edge and return hops
 *  in order. Returns `null` if the graph isn't a single simple path (a
 *  branch, a cycle, an isolated node, or more than one component) — chains
 *  only support straight-line hops. */
function hopsFromGraph(
  flowNodes: FlowNode[],
  edges: Edge[],
): { id: string; hop: ChainHop }[] | null {
  if (flowNodes.length === 0) return [];
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const n of flowNodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, 0);
  }
  for (const e of edges) {
    if (!outgoing.has(e.source) || !incoming.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }
  // Every node must have out-degree <= 1 and in-degree <= 1 for a simple path.
  for (const n of flowNodes) {
    if ((outgoing.get(n.id)?.length ?? 0) > 1) return null;
    if ((incoming.get(n.id) ?? 0) > 1) return null;
  }
  const starts = flowNodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  if (starts.length !== 1) return null; // no unique entry, or a cycle with no start
  const order: FlowNode[] = [];
  let cur: FlowNode | undefined = starts[0];
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return null; // cycle
    seen.add(cur.id);
    order.push(cur);
    const nextId: string | undefined = outgoing.get(cur.id)?.[0];
    cur = nextId ? flowNodes.find((n) => n.id === nextId) : undefined;
  }
  if (order.length !== flowNodes.length) return null; // disconnected node(s)
  return order.map((n) => ({
    id: n.id,
    hop: n.data.hop as ChainHop,
  }));
}

function hopFlowId(hop: ChainHop): string {
  return hop.kind === "node" ? `node:${hop.node_id}` : `pool:${hop.pool_id}`;
}

/** Lay hops out left-to-right at a fixed spacing (used both for loading an
 *  existing chain and for a freshly-dropped candidate). Spacing covers the
 *  widest card (pool, 240px) plus connection breathing room. */
function layoutHops(
  hops: ChainHop[],
  nodeById: Map<string, ProxyNode>,
  poolById: Map<string, NodePool>,
  keywordNodes: ProxyNode[],
): FlowNode[] {
  return hops.map((hop, i) => ({
    id: hopFlowId(hop),
    type: "hop",
    position: { x: 40 + i * 320, y: 60 },
    data: { ...hopCardData(hop, nodeById, poolById, keywordNodes), hop },
  }));
}

/** Edge between two hops: bezier curve + animated dashes + closed arrow at
 *  the target — direction (client → internet) reads at a glance. Arrow color
 *  is themed via CSS (`.react-flow__arrowhead` override), since marker colors
 *  are baked as inline styles by xyflow. */
function hopEdge(sourceId: string, targetId: string): Edge {
  return {
    id: `${sourceId}->${targetId}`,
    source: sourceId,
    target: targetId,
    type: "default",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, strokeWidth: 2 },
  };
}

function edgesFromHops(hops: ChainHop[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < hops.length - 1; i++) {
    out.push(hopEdge(hopFlowId(hops[i]), hopFlowId(hops[i + 1])));
  }
  return out;
}

/** One entry in a RowMenu dropdown. */
type RowMenuItem = {
  key: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

/** Compact "⋮" overflow menu for pool rows and chain cards — the same idiom
    as the subscription card menu: opaque popover (never glass), capture-phase
    outside click via [data-chain-menu], Escape to close. The open id is owned
    by ChainPage (one menuId for every ⋮ on the page), so opening one menu
    closes the previous — per-instance state used to leave both open. Rows in
    the lower half of a list pass flipUp so the popup opens toward the
    roomier side.

    G2: pool rows and chain cards both thin down to Edit/Delete — diagnose
    lives on the chain card face, the share/export actions in the editor
    footer — the menu stays the overflow idiom, not the action hub. */
function RowMenu({
  id,
  openId,
  setOpenId,
  items,
  flipUp = false,
}: {
  id: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  items: RowMenuItem[];
  flipUp?: boolean;
}) {
  const { t } = useI18n();
  const open = openId === id;

  return (
    <div className="rule-menu chain-menu" data-chain-menu>
      <button
        type="button"
        className="rule-menu-trigger"
        aria-label={t("common.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
      >
        ⋮
      </button>
      {open && (
        <div className={`rule-menu-pop chain-menu-pop${flipUp ? " up" : ""}`} role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={`rule-menu-item${it.danger ? " danger" : ""}`}
              onClick={() => {
                setOpenId(null);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PoolRow({
  pool,
  keywordNodes,
  subscriptions,
  usedByChains,
  flipUp,
  openMenuId,
  setOpenMenuId,
  onEdit,
  onDelete,
}: {
  pool: NodePool;
  /** Enabled-subscription universe — keyword pools preview exactly what the
   *  runtime build matches (explicit counts come from the fixed node-ID
   *  references instead and don't need the list at all). */
  keywordNodes: ProxyNode[];
  /** Subscription list — subscription pools need the fresh owner (name
   *  lookup; a missing entry flips the row to "subscription gone"). */
  subscriptions: SubscriptionView[];
  /** How many chains route through this pool — deletion-risk hint. */
  usedByChains: number;
  /** Lower-half rows open the ⋮ menu upward (no room below the list). */
  flipUp: boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  let memberCount: number;
  let keywords: string | null;
  let subNote: string | null = null;
  let pillClass = "target-node";
  let pillText: string;
  if (pool.mode.mode === "explicit") {
    memberCount = pool.mode.node_ids.length;
    keywords = null;
    pillText = t("chain.poolModeExplicit");
  } else if (pool.mode.mode === "subscription") {
    const subId = pool.mode.subscription_id;
    memberCount = keywordNodes.filter(
      (n) => (n.subscription_id ?? "") === subId,
    ).length;
    keywords = null;
    pillClass = "target-smart";
    pillText = t("chain.poolModeSubscription");
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) subNote = t("chain.poolSubMissing");
    else if (!sub.enabled) subNote = t("chain.subDisabled");
  } else {
    const { include, exclude } = pool.mode;
    memberCount = keywordNodes.filter((n) =>
      poolKeywordMatch(n.name, include, exclude),
    ).length;
    keywords = [
      ...include.map((k) => `+${k}`),
      ...exclude.map((k) => `−${k}`),
    ].join(" ");
    pillClass = "target-smart";
    pillText = t("chain.poolModeKeyword");
  }
  return (
    <div className="chain-pool-row" title={keywords ?? undefined}>
      <span className="chain-pool-name">
        <span className="chain-pool-glyph" aria-hidden="true">
          <PoolGlyph />
        </span>
        {pool.name}
      </span>
      {(keywords || subNote) && (
        <span className="chain-pool-row-kw">{subNote ?? keywords}</span>
      )}
      <span className={`pill ${pillClass}`}>{pillText}</span>
      <span className="chain-row-meta">
        {memberCount} {t("chain.poolMembersSuffix")}
      </span>
      {usedByChains > 0 && (
        <span className="chain-row-meta chain-card-usage">
          {t("chain.usedByChains", { n: usedByChains })}
        </span>
      )}
      <RowMenu
        id={`pool-${pool.id}`}
        openId={openMenuId}
        setOpenId={setOpenMenuId}
        flipUp={flipUp}
        items={[
          { key: "edit", label: t("common.edit"), onClick: onEdit },
          { key: "delete", label: t("common.delete"), danger: true, onClick: onDelete },
        ]}
      />
    </div>
  );
}

function SubscriptionNodeGroup({
  group,
  open,
  onToggle,
  children,
  className = "chain-candidate-group",
}: {
  group: NodeGroup;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        className="chain-candidate-group-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="chain-candidate-group-arrow" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="chain-candidate-group-name">{group.label}</span>
        <span className="chain-candidate-group-count">{group.nodes.length}</span>
      </button>
      {open && children}
    </div>
  );
}

/** Pointer activation must not turn the pool's 8px picker into a focused
 *  text-field-like control: App.css intentionally glows .field input:focus.
 *  Prevent only the primary pointer's default focus step. Edge's label
 *  activation can still forward a click to the input, so that label-generated
 *  click is cancelled and dispatched to the same state updater explicitly.
 *  Direct input clicks and keyboard Space retain native onChange behavior. */
function preventPoolRowPointerFocus(event: { button: number; preventDefault: () => void }) {
  if (event.button === 0) event.preventDefault();
}

function handlePoolRowClick(event: React.MouseEvent<HTMLLabelElement>, toggle: () => void) {
  if (event.target instanceof HTMLInputElement) return;
  event.preventDefault();
  toggle();
}

function PoolEditorModal({
  pool,
  nodes,
  keywordNodes,
  subscriptions,
  onClose,
  onSaved,
}: {
  /** `null` = creating a new pool. */
  pool: NodePool | null;
  /** Full stored-node universe (any subscription, including disabled ones):
   *  explicit pools hold fixed node-ID references, so their members must
   *  keep showing even after the owning subscription is switched away. */
  nodes: ProxyNode[];
  /** Enabled-subscription universe — the live keyword-match preview keeps
   *  the runtime's enabled-only semantics (cross-subscription needs an
   *  explicit pool instead). */
  keywordNodes: ProxyNode[];
  /** Fresh subscription list — the subscription picker; custom profiles
   *  (raw config, contributes_nodes() == false) are filtered out. */
  subscriptions: SubscriptionView[];
  onClose: () => void;
  /** 追加1：pruned = 后端保存时自动剔除的失效成员数（显式池悬空引用
   *  自愈），0 = 无剔除；调用方据此提示「已剔除 N 个」。 */
  onSaved: (pruned: number) => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(pool?.name ?? "");
  const [mode, setMode] = useState<"explicit" | "keyword" | "subscription">(
    pool?.mode.mode ?? "explicit",
  );
  const [nodeIds, setNodeIds] = useState<Set<string>>(
    new Set(pool?.mode.mode === "explicit" ? pool.mode.node_ids : []),
  );
  const [include, setInclude] = useState(
    pool?.mode.mode === "keyword" ? pool.mode.include.join(" ") : "",
  );
  const [exclude, setExclude] = useState(
    pool?.mode.mode === "keyword" ? pool.mode.exclude.join(" ") : "",
  );
  const [subscriptionId, setSubscriptionId] = useState(
    pool?.mode.mode === "subscription" ? pool.mode.subscription_id : "",
  );
  const [manualOpenGroups, setManualOpenGroups] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [nodes, query]);
  const hasPoolQuery = query.trim().length > 0;
  const poolNodeGroups = useMemo(
    () => groupNodes(filteredNodes, "sub", locale, {
      other: t("nodes.groupOther"),
      noSub: t("nodes.groupNoSub"),
      chains: t("nodes.groupChains"),
    }),
    [filteredNodes, locale, t],
  );

  function toggleNode(id: string) {
    setNodeIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Live keyword-filter preview: same parsing + matching as submit, so the
  // count/names shown while typing are exactly what the pool will contain.
  // Keyword pools match the enabled-subscription universe only.
  const matchedNodes = useMemo(
    () =>
      enabledUniverse(keywordNodes).filter((n) =>
        poolKeywordMatch(n.name, parseKeywords(include), parseKeywords(exclude)),
      ),
    [keywordNodes, include, exclude],
  );;

  // Local subscription picker: raw-config (custom) profiles never feed
  // nodes, so they stay out of the pool targets; disabled subscriptions
  // remain pickable — their pool builds empty until re-enabled (same
  // tolerance as the backend validate arm).
  const pickableSubs = useMemo(
    () => subscriptions.filter((s) => s.source_kind !== "custom"),
    [subscriptions],
  );
  const subscriptionGone =
    subscriptionId !== "" && !subscriptions.some((s) => s.id === subscriptionId);

  async function onSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("chain.needPoolName"));
      return;
    }
    const poolMode: PoolMode =
      mode === "explicit"
        ? { mode: "explicit", node_ids: Array.from(nodeIds) }
        : mode === "subscription"
          ? { mode: "subscription", subscription_id: subscriptionId.trim() }
          : { mode: "keyword", include: parseKeywords(include), exclude: parseKeywords(exclude) };
    if (poolMode.mode === "explicit" && poolMode.node_ids.length === 0) {
      setError(t("chain.needPoolNodes"));
      return;
    }
    if (poolMode.mode === "subscription" && !poolMode.subscription_id) {
      setError(t("chain.needPoolSub"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (pool) {
        const result = await updatePool(pool.id, trimmed, poolMode);
        onSaved(result.pruned);
      } else {
        await createPool(trimmed, poolMode);
        onSaved(0);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal rules-form-modal">
        <header className="modal-header">
          <h2>{pool ? t("chain.editPool") : t("chain.newPool")}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>{t("chain.poolName")}</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("chain.poolNamePh")}
              maxLength={64}
              autoFocus
            />
          </label>
          <label className="field">
            <span>{t("chain.poolMode")}</span>
            <GlassSeg
              value={mode}
              ariaLabel={t("chain.poolMode")}
              onChange={(v) => setMode(v as "explicit" | "keyword" | "subscription")}
              options={[
                { value: "explicit", label: t("chain.poolModeExplicit") },
                { value: "keyword", label: t("chain.poolModeKeyword") },
                { value: "subscription", label: t("chain.poolModeSubscription") },
              ]}
            />
          </label>
          {mode === "explicit" ? (
            <div className="field rule-node-pick">
              <span>{t("chain.poolPickNodes")}</span>
              {nodes.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {t("rules.noNodes")}
                </p>
              ) : (
                <>
                  <input
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("rules.pickNodePh")}
                  />
                  <div className="chain-pool-node-list">
                    {poolNodeGroups.map((group) => {
                      const open = group.key in manualOpenGroups
                        ? manualOpenGroups[group.key]
                        : hasPoolQuery;
                      return (
                        <SubscriptionNodeGroup
                          key={group.key}
                          group={group}
                          open={open}
                          className="chain-candidate-group chain-pool-node-group"
                          onToggle={() => setManualOpenGroups((cur) => ({ ...cur, [group.key]: !open }))}
                        >
                          {group.nodes.map((n) => (
                            <label
                              key={n.id}
                              className="chain-pool-node-item"
                              data-node-id={n.id}
                              data-disabled={n.enabled === false ? "" : undefined}
                              title={
                                n.enabled === false && n.subscription_name
                                  ? `${n.subscription_name} · ${t("chain.subDisabled")}`
                                  : n.subscription_name || undefined
                              }
                              onMouseDown={preventPoolRowPointerFocus}
                              onClick={(event) => handlePoolRowClick(event, () => toggleNode(n.id))}
                            >
                              <input
                                className="chain-pool-select-dot"
                                type="checkbox"
                                value={n.id}
                                checked={nodeIds.has(n.id)}
                                onChange={() => toggleNode(n.id)}
                              />
                              <span>{n.name}</span>
                              {n.subscription_name && (
                                <span className="chain-node-sub">{n.subscription_name}</span>
                              )}
                            </label>
                          ))}
                        </SubscriptionNodeGroup>
                      );
                    })}
                    {filteredNodes.length === 0 && (
                      <p className="muted" style={{ margin: "6px", fontSize: 12 }}>{t("chain.noMatch")}</p>
                    )}
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                    {t("chain.poolSelectedCount", { n: nodeIds.size })}
                  </p>
                </>
              )}
            </div>
          ) : mode === "keyword" ? (
            <div className="field rule-smart-filters">
              <label className="field" style={{ marginBottom: 8 }}>
                <span>{t("rules.smartInclude")}</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={include}
                  onChange={(e) => setInclude(e.target.value)}
                  placeholder={t("rules.smartIncludePh")}
                />
              </label>
              <label className="field">
                <span>{t("rules.smartExclude")}</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={exclude}
                  onChange={(e) => setExclude(e.target.value)}
                  placeholder={t("rules.smartExcludePh")}
                />
              </label>
              {/* Live match feedback while typing keywords. */}
              <div className="chain-pool-match">
                <span className="chain-pool-match-count">
                  {t("chain.matchedNodes", { n: matchedNodes.length })}
                  {parseKeywords(include).length === 0 &&
                    ` · ${t("chain.poolKeywordAll")}`}
                </span>
                {matchedNodes.length > 0 && (
                  <span
                    className="chain-pool-match-names"
                    title={matchedNodes.map((n) => n.name).join(" · ")}
                  >
                    {matchedNodes
                      .slice(0, 6)
                      .map((n) => n.name)
                      .join(" · ") + (matchedNodes.length > 6 ? " …" : "")}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="field rule-node-pick">
              <span>{t("chain.poolPickSub")}</span>
              {pickableSubs.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {t("chain.poolSubEmptyList")}
                </p>
              ) : (
                <>
                  <div className="chain-pool-node-list">
                    {pickableSubs.map((s) => (
                      <label
                        key={s.id}
                        className="chain-pool-node-item"
                        data-disabled={s.enabled ? undefined : ""}
                        title={
                          s.enabled
                            ? t("chain.poolSubHint")
                            : `${t("chain.subDisabled")} · ${t("chain.poolSubHint")}`
                        }
                        onMouseDown={preventPoolRowPointerFocus}
                        onClick={(event) => handlePoolRowClick(event, () => setSubscriptionId(s.id))}
                      >
                        <input
                          className="chain-pool-select-dot"
                          type="radio"
                          name="chain-pool-subscription"
                          checked={subscriptionId === s.id}
                          onChange={() => setSubscriptionId(s.id)}
                        />
                        <span>{s.name}</span>
                        {!s.enabled && (
                          <span className="chain-node-sub">{t("chain.subDisabled")}</span>
                        )}
                      </label>
                    ))}
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                    {subscriptionGone
                      ? t("chain.poolSubMissing")
                      : t("chain.poolSubHint")}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <GlassButton onClick={onClose}>{t("common.cancel")}</GlassButton>
          <GlassButton variant="primary" disabled={busy} onClick={() => void onSubmit()}>
            {t("common.save")}
          </GlassButton>
        </footer>
      </div>
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
    </div>
  );
}

function ChainFlowEditor({
  chain,
  nodes,
  pools,
  nodeById,
  poolById,
  keywordNodes,
  onSubmit,
  busy,
  onClose,
  autoName,
  onShareText,
  onShareYaml,
}: {
  chain: ProxyChain | null;
  nodes: ProxyNode[];
  pools: NodePool[];
  nodeById: Map<string, ProxyNode>;
  poolById: Map<string, NodePool>;
  /** Enabled-subscription universe — keyword pool previews on hop cards
   *  mirror the runtime's enabled-only keyword semantics. */
  keywordNodes: ProxyNode[];
  onSubmit: (flowNodes: FlowNode[], edges: Edge[]) => void;
  busy: boolean;
  onClose: () => void;
  /** New-chain mode: receives "A → B → C" derived from the live graph order,
   *  so the name field can auto-follow the hops being placed. */
  autoName?: (label: string) => void;
  /** G2: share/export actions pulled from the card menu into the footer —
   *  null for new chains (nothing to share yet) or non-exportable ones. */
  onShareText?: (() => void) | null;
  onShareYaml?: (() => void) | null;
}) {
  const { t, locale } = useI18n();
  const { screenToFlowPosition, fitView, getZoom, getViewport, setCenter } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<FlowNode>(
    layoutHops(chain?.hops ?? [], nodeById, poolById, keywordNodes),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    edgesFromHops(chain?.hops ?? []),
  );
  const [candidateKind, setCandidateKind] = useState<"node" | "pool">("node");
  // Pool-candidate expansion: members listed under one pool at a time;
  // clicking a member row appends it straight to the chain tail (drag
  // still positions it on the canvas). No staging/selection state anymore.
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);
  // Quick filter over the sidebar candidates — substring match on the name,
  // same convention as the pool editor's node picker.
  const [candidateQuery, setCandidateQuery] = useState("");
  const candidateNodes = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [nodes, candidateQuery]);
  const candidatePools = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return pools;
    return pools.filter((p) => p.name.toLowerCase().includes(q));
  }, [pools, candidateQuery]);
  // G4: subscription-grouped node candidates — same "sub" grouping the
  // nodes page uses. Extra state below is intentionally minimal: groups are
  // collapsed unless explicitly toggled open, and an active query forces
  // every group open (matches must be visible without hunting through
  // collapsed heads). The old flat list kept the entire subscription in the
  // DOM (~1000 rows), so grouping fixed both navigation and render load.
  // One map of explicit user toggles: a group defaults to collapsed
  // without a query and to open with one — the user's last toggle always
  // wins over the default.
  const [manualOpenGroups, setManualOpenGroups] = useState<Record<string, boolean>>({});
  const hasQuery = candidateQuery.trim().length > 0;
  const candidateGroups = useMemo(
    () =>
      groupNodes(candidateNodes, "sub", locale, {
        other: t("nodes.groupOther"),
        noSub: t("nodes.groupNoSub"),
        chains: t("nodes.groupChains"),
      }),
    [candidateNodes, locale, t],
  );
  // Nodes already on the canvas (individual hops only — pool hops are a
  // reference to the pool, their members are fair game as singles) dim in
  // the list so a duplicate is visible before it gets dragged. Still
  // draggable: placing the same node twice has legitimate uses when
  // isValidConnection permits the path.
  const onCanvasNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of flowNodes) {
      const hop = n.data.hop as ChainHop | undefined;
      if (hop && hop.kind === "node") ids.add(hop.node_id);
    }
    return ids;
  }, [flowNodes]);
  // Manual pointer-based drag: WKWebView (macOS Tauri) doesn't reliably fire
  // HTML5 drag-and-drop events (dragstart/drop over DataTransfer), so the
  // sidebar → canvas drag is implemented with pointer events instead — a
  // "ghost" label follows the cursor, and dropping is resolved by hit-testing
  // the canvas element under the pointer on release.
  const [dragging, setDragging] = useState<
    {
      hop: ChainHop;
      label: string;
      x: number;
      y: number;
      sx: number;
      sy: number;
      isPool: boolean;
    } | null
  >(null);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;

  // Current graph-derived hop order (null = not a single simple path), used
  // for the live validity status and the numbered badges on each node.
  const graphOrder = useMemo(() => hopsFromGraph(flowNodes, edges), [flowNodes, edges]);

  // "A → B → C" from the live graph order — feeds the new-chain auto-name.
  // Computed as a string so the effect below only fires when it actually
  // changes (position-only drags don't re-trigger it).
  const autoNameLabel = useMemo(() => {
    if (!graphOrder) return null;
    return graphOrder
      .map((o) => String(flowNodes.find((n) => n.id === o.id)?.data.label ?? ""))
      .join(" → ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphOrder]);

  useEffect(() => {
    if (autoName && autoNameLabel != null) autoName(autoNameLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNameLabel]);

  // Fit exactly once, and only when the editor was opened with saved hops.
  // Fitting on node-count changes (the old behavior) panned/zoomed the
  // viewport away from the cursor right after a drop, so the new node looked
  // like it hadn't stayed where it was released. Waiting for
  // `useNodesInitialized` matters too: node dimensions are measured
  // asynchronously (ResizeObserver), and fitting against unmeasured 0×0
  // nodes computes a broken viewport that leaves the canvas looking empty.
  // The canvas-size re-check guards against the flex-sized modal settling
  // after the nodes were already measured.
  const openedWithHopsRef = useRef((chain?.hops?.length ?? 0) > 0);
  const nodesInitialized = useNodesInitialized();
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current || !openedWithHopsRef.current) return;
    const el = canvasRef.current;
    if (!el) return;
    const tryFit = () => {
      if (didFitRef.current || !nodesInitialized) return;
      if (el.clientWidth < 2 || el.clientHeight < 2) return;
      didFitRef.current = true;
      fitView({ padding: 0.3, duration: 250, maxZoom: 1.1 });
    };
    tryFit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(tryFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodesInitialized, fitView]);

  // Mirror the hop order into node data (badge number / entry-exit accent).
  // The merge is diffed so position-only changes (dragging nodes around)
  // don't loop through setFlowNodes.
  useEffect(() => {
    setFlowNodes((cur) => {
      let changed = false;
      const next = cur.map((n) => {
        const idx = graphOrder ? graphOrder.findIndex((o) => o.id === n.id) : -1;
        const index = idx === -1 ? null : idx + 1;
        const total = graphOrder ? graphOrder.length : null;
        if (n.data.index === index && n.data.total === total) return n;
        changed = true;
        return { ...n, data: { ...n.data, index, total } };
      });
      return changed ? next : cur;
    });
  }, [graphOrder]);

  // Linear-chain invariant, enforced while a connection is being dragged:
  // no self/parallel edges, at most one outgoing edge per hop and one
  // incoming edge per hop, and nothing that would close a cycle.
  // (`hopsFromGraph` at save time remains the backstop.)
  const isValidConnection = useCallback(
    (conn: Connection | Edge): boolean => {
      const { source, target } = conn;
      if (!source || !target || source === target) return false;
      if (edges.some((e) => e.source === source && e.target === target)) return false;
      if (edges.some((e) => e.source === source && e.target !== target)) return false;
      if (edges.some((e) => e.target === target && e.source !== source)) return false;
      const nextOf = new Map<string, string>();
      for (const e of edges) if (e.source !== source) nextOf.set(e.source, e.target);
      nextOf.set(source, target);
      let cur: string | undefined = target;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === source) return false; // target can already reach source → cycle
        seen.add(cur);
        cur = nextOf.get(cur);
      }
      return true;
    },
    [edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      setEdges((eds) => addEdge(connection, eds));
    },
    [isValidConnection, setEdges],
  );

  function selectOnly(id: string) {
    setFlowNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })));
    setEdges((cur) => cur.map((e) => ({ ...e, selected: false })));
  }

  /** Pan the viewport (zoom unchanged) just enough to bring a hop into view.
   *  Appending places the new hop to the right of the chain tail, which is
   *  regularly outside the current viewport on longer chains — without this
   *  the add looks like a no-op until "tidy layout" re-fits. */
  function revealPosition(position: { x: number; y: number }) {
    const el = canvasRef.current;
    const vp = getViewport();
    if (el) {
      const left = -vp.x / vp.zoom;
      const top = -vp.y / vp.zoom;
      const right = left + el.clientWidth / vp.zoom;
      const bottom = top + el.clientHeight / vp.zoom;
      // Card is ~260px wide worst case (pool) × ~100 tall; keep a margin so
      // it doesn't hug the edge.
      const m = 48;
      const visible =
        position.x - m >= left &&
        position.x + 260 + m <= right &&
        position.y - m >= top &&
        position.y + 100 + m <= bottom;
      if (visible) return;
    }
    setCenter(position.x + 130, position.y + 50, { zoom: vp.zoom, duration: 250 });
  }

  function dropHopAt(hop: ChainHop, clientX: number, clientY: number) {
    const id = hopFlowId(hop);
    if (flowNodes.some((n) => n.id === id)) {
      const existing = flowNodes.find((n) => n.id === id)!;
      selectOnly(id); // already on the canvas — surface it instead of a silent no-op
      revealPosition(existing.position);
      return;
    }
    // Center the card under the cursor (css-size/2 scaled back into flow
    // coordinates) so the node visually lands exactly where it was dropped.
    const p = screenToFlowPosition({ x: clientX, y: clientY });
    const zoom = getZoom();
    const position = { x: p.x - 95 / zoom, y: p.y - 30 / zoom };
    setFlowNodes((cur) => [
      ...cur,
      { id, type: "hop", position, data: { ...hopCardData(hop, nodeById, poolById, keywordNodes), hop } },
    ]);
  }

  /** Click (as opposed to drag) on a sidebar candidate: append the hop after
   *  the current chain tail, auto-connecting it so a chain can be built with
   *  keyboard-free clicks alone. */
  function appendHop(hop: ChainHop) {
    appendHops([hop]);
  }

  /** Append several hops in one state transition. Calling `appendHop` in
   *  a loop would re-read the stale flowNodes/edges between set-state calls
   * and drop all but the first hop, so positioning folds over one copy. */
  function appendHops(hops: ChainHop[]) {
    if (hops.length === 0) return;
    let nextNodes: FlowNode[] = flowNodes.map((n) => ({ ...n, selected: false }));
    let nextEdges: Edge[] = [...edges];
    let appendedAny = false;
    let existingSurfaceId: string | null = null;
    for (const hop of hops) {
      const id = hopFlowId(hop);
      if (nextNodes.some((n) => n.id === id)) {
        // Already on the canvas — surface it instead of a silent no-op,
        // same as the single-hop path.
        existingSurfaceId = id;
        continue;
      }
      const order = hopsFromGraph(nextNodes, nextEdges);
      const tailId = order && order.length > 0 ? order[order.length - 1].id : null;
      const anchor = tailId ? nextNodes.find((n) => n.id === tailId) : undefined;
      let position: { x: number; y: number };
      if (anchor) {
        position = { x: anchor.position.x + 320, y: anchor.position.y };
      } else if (nextNodes.length > 0) {
        const maxX = Math.max(...nextNodes.map((n) => n.position.x));
        position = { x: maxX + 320, y: 60 };
      } else {
        const rect = canvasRef.current?.getBoundingClientRect();
        position = rect
          ? screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            })
          : { x: 60, y: 60 };
      }
      const edgeTail = tailId;
      if (edgeTail && edgeTail !== id) {
        const edge = hopEdge(edgeTail, id);
        if (!nextEdges.some((e) => e.id === edge.id)) nextEdges = [...nextEdges, edge];
      }
      const card = hopCardData(hop, nodeById, poolById, keywordNodes);
      nextNodes = [
        ...nextNodes,
        {
          id,
          type: "hop",
          position,
          data: { ...card, hop },
          selected: true,
        },
      ];
      appendedAny = true;
    }
    if (!appendedAny) {
      if (existingSurfaceId) {
        const existing = nextNodes.find((n) => n.id === existingSurfaceId);
        setFlowNodes([
          ...nextNodes.map((n) => ({ ...n, selected: n.id === existingSurfaceId })),
        ]);
        if (existing) revealPosition(existing.position);
      }
      return;
    }
    setFlowNodes(nextNodes);
    setEdges(nextEdges);
    const lastHopNode = nextNodes[nextNodes.length - 1];
    if (lastHopNode) revealPosition(lastHopNode.position);
  }

  /** Re-lay the nodes into a clean left-to-right line (in graph order when
   *  the chain is valid, otherwise by current x position) and re-fit. */
  function tidyLayout() {
    const orderedIds =
      graphOrder && graphOrder.length === flowNodes.length
        ? graphOrder.map((o) => o.id)
        : [...flowNodes]
            .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
            .map((n) => n.id);
    const rank = new Map(orderedIds.map((id, i) => [id, i] as const));
    setFlowNodes((cur) =>
      cur.map((n) => {
        const i = rank.get(n.id) ?? 0;
        return { ...n, position: { x: 40 + i * 320, y: 60 } };
      }),
    );
    requestAnimationFrame(() => fitView({ padding: 0.3, duration: 250, maxZoom: 1.1 }));
  }

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: PointerEvent) {
      setDragging((cur) => (cur ? { ...cur, x: e.clientX, y: e.clientY } : cur));
    }

    function onUp(e: PointerEvent) {
      const current = draggingRef.current;
      setDragging(null);
      if (!current) return;
      // Released without moving = a plain click on the sidebar item.
      const moved = Math.hypot(e.clientX - current.sx, e.clientY - current.sy);
      if (moved < 5) {
        appendHop(current.hop);
        return;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const overCanvas = !!canvasRef.current && !!target && canvasRef.current.contains(target);
      if (overCanvas) {
        dropHopAt(current.hop, e.clientX, e.clientY);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDragging(null);
    }

    function onCancel() {
      setDragging(null);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey);
    };
    // appendHop/dropHopAt/draggingRef are read through refs/closures scoped
    // to this effect's own render — re-running only on dragging's presence
    // (not its x/y) avoids tearing down/re-attaching listeners on every
    // pointermove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging !== null]);

  function onCandidatePointerDown(e: React.PointerEvent, hop: ChainHop, label: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging({
      hop,
      label,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      isPool: hop.kind === "pool",
    });
  }

  /** I9：删除选中跳时自动桥接——删中间跳把前驱直接连到后继，链保持
   *  单线路径，序号从路径重派即自动补位（1..N 连续）；删首尾跳只移除
   *  邻边。当前图无效（分支/环/断开）时退回原行为：只过滤选中节点/边，
   *  修复留给用户自己接线（保持既有“需单线路径”校验语义）。序号口径不
   *  变：路径序（hopsFromGraph）即保存序，画布布局自始按路径序左→右
   *  排（load/append/tidy），故左→右即 1..N。 */
  function removeSelected() {
    const removed = flowNodes.filter((n) => n.selected);
    const removedIds = new Set(removed.map((n) => n.id));
    setFlowNodes((cur) => cur.filter((n) => !n.selected));
    if (graphOrder && graphOrder.length === flowNodes.length && removed.length > 0) {
      const keptIds = graphOrder
        .map((o) => o.id)
        .filter((id) => !removedIds.has(id));
      // Reconnect the remaining hops in path order — always a simple path:
      // in/out degrees stay <= 1 and the cycle check below can't loop.
      setEdges(keptIds.slice(1).map((id, i) => hopEdge(keptIds[i], id)));
      return;
    }
    setEdges((cur) => cur.filter((e) => !e.selected));
  }

  return (
    <>
      <div className="modal-body chain-editor-body">
        <p className="muted chain-editor-hint" title={t("chain.editorHint")}>
          {t("chain.editorHint")}
        </p>
        <div className="chain-editor-layout">
          <aside className="chain-editor-sidebar">
            <GlassSeg
              value={candidateKind}
              ariaLabel={t("chain.candidateKind")}
              onChange={(v) => setCandidateKind(v as "node" | "pool")}
              options={[
                { value: "node", label: t("rules.pickNode") },
                { value: "pool", label: t("chain.pool") },
              ]}
            />
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="search chain-candidate-search"
              value={candidateQuery}
              onChange={(e) => setCandidateQuery(e.target.value)}
              placeholder={
                candidateKind === "node" ? t("rules.pickNodePh") : t("chain.searchPoolPh")
              }
            />
            <div className="chain-candidate-list">
              {candidateKind === "node"
                ? candidateGroups.map((g) => {
                    // Default: collapsed without a query, open with one (the
                    // query already filtered to matches, hiding them behind a
                    // collapsed head would defeat the search). The manual
                    // toggle always wins: collapsing a noisy group during a
                    // search, or pre-opening one, both survive.
                    const open =
                      g.key in manualOpenGroups ? manualOpenGroups[g.key] : hasQuery;
                    return (
                      <SubscriptionNodeGroup
                        key={g.key}
                        group={g}
                        open={open}
                        onToggle={() => setManualOpenGroups((cur) => ({ ...cur, [g.key]: !open }))}
                      >
                        {g.nodes.map((n) => {
                          const onCanvas = onCanvasNodeIds.has(n.id);
                          return (
                            <div
                                key={n.id}
                                onPointerDown={(e) =>
                                  onCandidatePointerDown(e, { kind: "node", node_id: n.id }, n.name)
                                }
                                className={`chain-candidate-item${onCanvas ? " on-canvas" : ""}`}
                                data-disabled={n.enabled === false ? "" : undefined}
                                title={
                                  // 长名中段省略后，hover 全名 + 状态提示。
                                  n.enabled === false && n.subscription_name
                                    ? `${n.name} · ${n.subscription_name} · ${t("chain.subDisabled")}`
                                    : onCanvas
                                      ? `${n.name} · ${t("chain.alreadyOnCanvas")}`
                                      : `${n.name} · ${t("chain.dragHint")}`
                                }
                              >
                                <span className="chain-candidate-mark" aria-hidden="true">
                                  {onCanvas ? "●" : "○"}
                                </span>
                                <EllipsisTail text={n.name} />
                              </div>
                            );
                        })}
                      </SubscriptionNodeGroup>
                    );
                  })
                : candidatePools.map((p) => {
                    const expanded = expandedPoolId === p.id;
                    // Only expandable pools pay the preview cost (explicit
                    // pools resolve members from the full universe incl.
                    // disabled subscriptions; keyword pools re-match the
                    // enabled universe — same semantics as hop-card dots).
                    const preview = expanded ? chainPoolPreviewMembers(p, nodes) : [];
                    const liveMembers = preview.filter((m) => !m.stale);
                    const staleCount = preview.length - liveMembers.length;
                    return (
                      <div key={p.id} className={`chain-candidate-pool${expanded ? " expanded" : ""}`}>
                        <div className="chain-candidate-pool-row">
                          <div
                            className="chain-candidate-item pool-drag"
                            onPointerDown={(e) =>
                              onCandidatePointerDown(e, { kind: "pool", pool_id: p.id }, p.name)
                            }
                            title={`${p.name} · ${t("chain.dragHint")}`}
                          >
                            <span className="chain-candidate-glyph" aria-hidden="true">
                              <PoolGlyph />
                            </span>
                            <EllipsisTail text={p.name} />
                          </div>
                          <button
                            type="button"
                            className="chain-pool-expand"
                            aria-expanded={expanded}
                            aria-label={t("chain.expandPoolMembers")}
                            title={t("chain.expandPoolMembers")}
                            onClick={() =>
                              setExpandedPoolId(expanded ? null : p.id)
                            }
                          >
                            {expanded ? "▴" : "▾"}
                          </button>
                        </div>
                        {expanded && (
                          <div className="chain-pool-members">
                            {liveMembers.length === 0 && (
                              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                                {t("chain.noPoolMembers")}
                              </p>
                            )}
                            {liveMembers.map(({ node }) => {
                              const onCanvas = onCanvasNodeIds.has(node.id);
                              return (
                                <div
                                  key={node.id}
                                  // 点成员行 = 直接作为 node hop 追加到链尾（与
                                  // 候选节点同一手势：拖拽仍可定位投放）。
                                  onPointerDown={(e) =>
                                    onCandidatePointerDown(
                                      e,
                                      { kind: "node", node_id: node.id },
                                      node.name,
                                    )
                                  }
                                  className={`chain-pool-member${onCanvas ? " on-canvas" : ""}`}
                                  data-disabled={node.enabled === false ? "" : undefined}
                                  title={
                                    node.enabled === false && node.subscription_name
                                      ? `${node.name} · ${node.subscription_name} · ${t("chain.subDisabled")}`
                                      : onCanvas
                                        ? `${node.name} · ${t("chain.alreadyOnCanvas")}`
                                        : node.subscription_name
                                          ? `${node.name} · ${node.subscription_name} · ${t("chain.dragHint")}`
                                          : `${node.name} · ${t("chain.dragHint")}`
                                  }
                                >
                                  <span className="chain-candidate-mark" aria-hidden="true">
                                    {onCanvas ? "●" : "○"}
                                  </span>
                                  <EllipsisTail text={node.name} />
                                  {node.subscription_name && (
                                    <span className="chain-node-sub">{node.subscription_name}</span>
                                  )}
                                </div>
                              );
                            })}
                            {staleCount > 0 && (
                              <p
                                className="muted"
                                style={{ margin: 0, fontSize: 11 }}
                                title={t("chain.poolStaleHint", { n: staleCount })}
                              >
                                {t("chain.poolStaleHint", { n: staleCount })}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              {candidateKind === "node" && nodes.length === 0 && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {t("rules.noNodes")}
                </p>
              )}
              {candidateKind === "pool" && pools.length === 0 && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {t("chain.noPools")}
                </p>
              )}
              {((candidateKind === "node" && nodes.length > 0) ||
                (candidateKind === "pool" && pools.length > 0)) &&
                (candidateKind === "node" ? candidateNodes.length : candidatePools.length) ===
                  0 && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    {t("chain.noMatch")}
                  </p>
                )}
            </div>
            <div className="chain-editor-sidebar-actions">
              <GlassButton onClick={removeSelected}>{t("chain.removeSelected")}</GlassButton>
              <GlassButton onClick={tidyLayout}>{t("chain.tidyLayout")}</GlassButton>
            </div>
          </aside>
          <div className="chain-editor-canvas-col">
            <div className="chain-editor-canvas" ref={canvasRef}>
              <ReactFlow
                nodes={flowNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                minZoom={0.2}
                maxZoom={2}
                deleteKeyCode={["Backspace", "Delete"]}
                panOnScroll
                zoomOnScroll={false}
                defaultEdgeOptions={{
                  type: "default",
                  animated: true,
                  markerEnd: { type: MarkerType.ArrowClosed, strokeWidth: 2 },
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                {/* H: showFitView gives a manual canvas reset for pans that
                    lost the chain; onFitView re-applies the app's own fit
                    options so the manual button and the auto paths share one
                    viewport policy (padding/maxZoom), zero new behavior. */}
                <Controls
                  showInteractive={false}
                  onFitView={() =>
                    fitView({ padding: 0.3, duration: 250, maxZoom: 1.1 })
                  }
                />
              </ReactFlow>
            </div>
            <p
              className={`chain-graph-status${
                graphOrder === null ? " bad" : flowNodes.length === 0 ? "" : " ok"
              }`}
            >
              {graphOrder === null
                ? t("chain.graphInvalid")
                : flowNodes.length === 0
                  ? t("chain.graphEmpty")
                  : t("chain.graphValid", { n: graphOrder.length })}
            </p>
          </div>
        </div>
      </div>
      {dragging && (
        <div className="chain-drag-ghost" style={{ left: dragging.x, top: dragging.y }}>
          {dragging.isPool && (
            <span className="chain-drag-glyph" aria-hidden="true">
              <PoolGlyph />
            </span>
          )}
          {dragging.label}
        </div>
      )}
      <footer className="modal-footer">
        {(onShareText || onShareYaml) && (
          <span className="chain-editor-share">
            {onShareText && (
              <GlassButton onClick={onShareText}>{t("chain.copyText")}</GlassButton>
            )}
            {onShareYaml && (
              <GlassButton onClick={onShareYaml}>{t("chain.exportMihomo")}</GlassButton>
            )}
          </span>
        )}
        <GlassButton onClick={onClose}>{t("common.cancel")}</GlassButton>
        <GlassButton
          variant="primary"
          disabled={busy}
          onClick={() => onSubmit(flowNodes, edges)}
        >
          {t("common.save")}
        </GlassButton>
      </footer>
    </>
  );
}

/** One probe cell: green ms on success, red ✗ (tooltip = raw error) on
 *  failure, em-dash when there was nothing to probe. */
function DiagCell({
  ms,
  error,
  stale,
  staleText,
}: {
  ms?: number | null;
  error?: string | null;
  stale?: boolean;
  staleText: string;
}) {
  if (stale) return <span className="chain-diag-cell bad" title={staleText}>✗ {staleText}</span>;
  if (ms != null) return <span className="chain-diag-cell ok">{ms} ms</span>;
  if (error) return <span className="chain-diag-cell bad" title={error}>✗</span>;
  return <span className="chain-diag-cell">—</span>;
}

/** Chain diagnostics: per-hop solo + chain-prefix probes through the live
 *  Clash delay API. The last hop's "chained" column IS the whole chain (the
 *  exit the internet sees). solo-ok + chained-failed localizes the break to
 *  the relay into that hop. */
function ChainDiagModal({ chain, onClose }: { chain: ProxyChain; onClose: () => void }) {
  const { t } = useI18n();
  const [diag, setDiag] = useState<ChainDiagnosis | null>(null);
  // Manual-start flow: idle until the user clicks (a stale `true` here shows
  // the spinner AND disables the start button — permanently stuck).
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setDiag(await diagnoseChain(chain.id));
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  }, [chain.id]);

  // No auto-run: probing switches a selector and spends real round-trips,
  // so it starts on an explicit click (the footer's primary button).

  return (
    <div className="modal-backdrop">
      <div className="modal chain-diag-modal">
        <header className="modal-header">
          <h2>{t("chain.diagTitle", { name: chain.name })}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <div className="chain-diag-table">
            <div className="chain-diag-row chain-diag-head">
              <span>{t("chain.diagHop")}</span>
              <span>{t("chain.diagSolo")}</span>
              <span>{t("chain.diagChained")}</span>
            </div>
            {busy && (
              <div className="chain-diag-loading">
                <span className="chain-diag-spinner" aria-hidden="true" />
                <span>{t("chain.diagRunning")}</span>
              </div>
            )}
            {!busy && !diag && <p className="muted chain-diag-idle">{t("chain.diagIdle")}</p>}
            {diag?.hops.map((h, i) => {
              const last = i === diag.hops.length - 1;
              return (
                <div key={i} className={`chain-diag-row${last ? " whole" : ""}`}>
                  <span className="chain-diag-hop">
                    <span className="chain-diag-order">{i + 1}</span>
                    {h.kind === "pool" && (
                      <span className="chain-candidate-glyph" aria-hidden="true">
                        <PoolGlyph />
                      </span>
                    )}
                    <span className={`chain-diag-label${h.stale ? " stale" : ""}`} title={h.label}>
                      {h.label}
                    </span>
                    {last && <span className="chain-diag-exit">{t("chain.diagExit")}</span>}
                  </span>
                  <DiagCell
                    ms={h.soloMs}
                    error={h.soloError}
                    stale={h.stale}
                    staleText={t("rules.nodeStale")}
                  />
                  <DiagCell
                    ms={h.chainedMs}
                    error={h.chainedError}
                    stale={h.stale}
                    staleText={t("rules.nodeStale")}
                  />
                </div>
              );
            })}
            {diag && (
              <div className="chain-diag-exit-block">
                <div className="chain-diag-exit-row">
                  <span className="chain-diag-exit-label">ip.sb</span>
                  <DiagCell
                    ms={diag.exit.ipSbMs}
                    error={diag.exit.ipSbError}
                    staleText={t("rules.nodeStale")}
                  />
                </div>
                <div className="chain-diag-exit-row">
                  <span className="chain-diag-exit-label">{t("chain.diagRealExit")}</span>
                  {diag.exit.geo ? (
                    <span className="chain-diag-cell ok chain-diag-exit-ip" title={diag.exit.geo.ip}>
                      {diag.exit.geo.ip}
                    </span>
                  ) : (
                    <DiagCell error={diag.exit.ipError} staleText={t("rules.nodeStale")} />
                  )}
                </div>
                {diag.exit.geo && (
                  <div className="chain-diag-geo">
                    {!!diag.exit.geo.countryCode && (
                      <span className="chain-diag-geo-cc" title={diag.exit.geo.country ?? undefined}>
                        {diag.exit.geo.countryCode.toUpperCase()}
                      </span>
                    )}
                    <span className="chain-diag-geo-place">
                      {[diag.exit.geo.country, diag.exit.geo.region, diag.exit.geo.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {(diag.exit.geo.asn || diag.exit.geo.asnOrganization) && (
                      <span
                        className="chain-diag-geo-asn"
                        title={diag.exit.geo.organization ?? undefined}
                      >
                        {[diag.exit.geo.asn, diag.exit.geo.asnOrganization]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    {!!diag.exit.geo.timezone && (
                      <span className="chain-diag-geo-tz">{diag.exit.geo.timezone}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="muted chain-diag-hint">{t("chain.diagHint")}</p>
        </div>
        <footer className="modal-footer">
          <GlassButton
            variant="primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy
              ? t("chain.diagRunning")
              : diag
                ? t("chain.diagRerun")
                : t("chain.diagStart")}
          </GlassButton>
          <GlassButton onClick={onClose}>{t("common.close")}</GlassButton>
        </footer>
      </div>
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
    </div>
  );
}

function ChainEditorModal({
  chain,
  nodes,
  keywordNodes,
  pools,
  onShareText,
  onShareYaml,
  onClose,
  onSaved,
}: {
  /** `null` = creating a new chain. */
  chain: ProxyChain | null;
  nodes: ProxyNode[];
  /** Enabled-subscription universe for keyword pool previews on hop cards. */
  keywordNodes: ProxyNode[];
  pools: NodePool[];
  /** G2: card-menu share actions relocated to the editor footer — only
   *  existing chains can be shared out (the caller passes null otherwise). */
  onShareText: (() => void) | null;
  onShareYaml: (() => void) | null;
  onClose: () => void;
  /** Save-completed signal — the caller closes the editor and reloads. */
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);

  const [name, setName] = useState(chain?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Empty-name on save is surfaced inline (focus + highlight) instead of an
  // error modal, so the user can just type the name and hit save again.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [nameMissing, setNameMissing] = useState(false);
  // Name-origin tracking for the auto-follow sync: chains whose name was
  // generated from the graph ("A → B → C", name_manual === false) keep
  // auto-naming in the editor AND get re-derived on page load when a hop's
  // node/pool was renamed elsewhere; typing into the field once pins the
  // name (name_manual = true — never auto-rewritten again). Chains saved
  // before the flag existed (name_manual undefined) count as manual so old
  // names are never silently changed. Clearing the field resumes
  // auto-generation.
  const nameDirtyRef = useRef(chain != null ? chain.name_manual !== false : false);
  const handleAutoName = useCallback((label: string) => {
    if (nameDirtyRef.current) return;
    setName(label.slice(0, 64));
  }, []);

  function onNameChange(value: string) {
    setName(value);
    nameDirtyRef.current = value.trim().length > 0;
    if (nameMissing && value.trim()) setNameMissing(false);
  }

  async function onSubmit(flowNodes: FlowNode[], edges: Edge[]) {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameMissing(true);
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
      return;
    }
    const ordered = hopsFromGraph(flowNodes, edges);
    if (ordered === null) {
      setError(t("chain.needLinearChain"));
      return;
    }
    if (ordered.length < 2) {
      setError(t("chain.needAtLeastTwoHops"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const hops = ordered.map((o) => o.hop);
      // Persist the name-origin marker for the mount-time rename sync:
      // hand-edited → true (pinned), untouched generated name → false
      // (keeps following node/pool renames; see syncAutoChainNames).
      const nameManual =
        chain != null
          ? nameDirtyRef.current || chain.name_manual !== false
          : nameDirtyRef.current;
      if (chain) {
        await updateChain(chain.id, trimmed, hops, nameManual);
      } else {
        await createChain(trimmed, hops, nameManual);
      }
      onSaved();
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal chain-editor-modal">
        <header className="modal-header">
          <h2>{chain ? t("chain.editChain") : t("chain.newChain")}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <label
          className={`field chain-editor-name-field${nameMissing ? " field-invalid" : ""}`}
        >
          <span>{t("chain.chainName")}</span>
          <input
            ref={nameInputRef}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("chain.chainNamePh")}
            maxLength={64}
            autoFocus
          />
          {nameMissing && <em className="field-invalid-msg">{t("chain.needChainName")}</em>}
        </label>
        <ReactFlowProvider>
          <ChainFlowEditor
            chain={chain}
            nodes={nodes}
            pools={pools}
            nodeById={nodeById}
            poolById={poolById}
            keywordNodes={keywordNodes}
            onSubmit={onSubmit}
            busy={busy}
            onClose={onClose}
            autoName={
              // Live-follow only while the name is still generated:
              // untouched auto chains (name_manual === false) keep syncing in
              // the field too; manual/legacy names and chains with a stale
              // hop (whose label would regress to raw ids) never move.
              (chain == null || chain.name_manual === false) &&
              !chain?.hops.some((h) => hopLabel(h, nodeById, poolById).stale)
                ? handleAutoName
                : undefined
            }
            onShareText={onShareText}
            onShareYaml={onShareYaml}
          />
        </ReactFlowProvider>
      </div>
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
    </div>
  );
}

export function ChainPage({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useI18n();
  const [pools, setPools] = useState<NodePool[]>([]);
  const [chains, setChains] = useState<ProxyChain[]>([]);
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  /** Subscription list — names for subscription pools (PoolRow owner lookup
   *  + the editor's picker). Reloaded together with pools so the pool row
   *  stays in sync right after add/remove/profile edits. */
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** G1: live activation context — current exit id, core running and the
   *  primary core kind (chain exits only exist under sing-box; E3 hides
   *  the virtual entries on the other cores). Seeded from the module
   *  snapshot to avoid a default-value flash, then kept in sync by the
   *  proxy-status snapshot stream. */
  const [active, setActive] = useState<{
    currentNodeId: string | null;
    coreType: string;
    running: boolean;
  }>(() => {
    const s = peekSettings();
    return {
      currentNodeId: s?.current_node_id ?? null,
      coreType: s?.core_type ?? "singbox",
      running: false,
    };
  });
  /** Chain id whose activation is in flight (disables every chain control). */
  const [activating, setActivating] = useState<string | null>(null);
  /** H②: exit-IP reading for the in-use chain card. Keyed by chain id so a
   *  stale reading from a previously active chain never leaks onto another
   *  card; only the active chain renders it. */
  const [exitProbe, setExitProbe] = useState<{
    chainId: string;
    busy: boolean;
    info?: ExitIpInfo;
    error?: string;
  } | null>(null);
  const [poolEditor, setPoolEditor] = useState<{ pool: NodePool | null } | null>(null);
  const [chainEditor, setChainEditor] = useState<{ chain: ProxyChain | null } | null>(null);
  /** Chain currently being edited, if any — hoisted so closure props keep
      the null narrowing (G2 footer share handlers rebind to it directly). */
  const editingChain = chainEditor?.chain ?? null;
  const [diagFor, setDiagFor] = useState<ProxyChain | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: "pool" | "chain"; id: string; name: string } | null
  >(null);
  /** Which ⋮ menu is open ("pool-…"/"chain-…") — single owner for every
      RowMenu on the page so a second one replaces the first. */
  const [menuId, setMenuId] = useState<string | null>(null);
  /** Transient feedback after a copy/export menu action (auto-clears). */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  function showNotice(message: string, durationMs = 2200) {
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    setNotice(message);
    if (durationMs > 0) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), durationMs);
    }
  }

  /** D-3: chain as shareable text (`链名: [入口] a → [出口] b`). */
  async function copyChainText(c: ProxyChain) {
    try {
      await copyNodeShareText(await exportChainText(c.id));
      showNotice(t("chain.textCopied"));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }

  /** D-1: standalone mihomo YAML expressing the same hops via `dialer-proxy`.
   *  Pool hops / dead references / unsupported protocols error out on the
   *  backend — surface the message, never fall back. */
  async function copyChainMihomoYaml(c: ProxyChain) {
    try {
      await copyNodeShareText(await exportChainMihomoYaml(c.id));
      showNotice(t("chain.yamlCopied"), 3000);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }

  useEffect(() => {
    if (!menuId) return;
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-chain-menu]")) return;
      setMenuId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuId(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);
  /** H③: id sets for the dead-reference check — memoized once per reload so
   *  each card's check stays O(hops), never O(nodes) per card. */
  const nodeIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const poolIdSet = useMemo(() => new Set(pools.map((p) => p.id)), [pools]);
  /** Enabled-subscription universe — every keyword-style preview on this
   *  page (pool row counts, editor preimages, hop-card dot grids) mirrors
   *  the runtime's enabled-only keywords; explicit pools and chains keep
   *  listing their full cross-subscription references. */
  const enabledNodes = useMemo(() => enabledUniverse(nodes), [nodes]);
  const poolChainCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of chains) {
      for (const h of c.hops) {
        if (h.kind === "pool") counts.set(h.pool_id, (counts.get(h.pool_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [chains]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, n, subs] = await Promise.all([
        listPools(),
        listChains(),
        listChainNodes(),
        listSubscriptions(),
      ]);
      // 链名跟随：进入/刷新链页时，未手改过的链按当前节点/池现名重算
      // 「A → B」——与编辑器内自动命名同一套 chainAutoLabel 口径，改库不
      // 重启（生成配置按 id 引用链）。
      const nodeMap = new Map(n.map((x) => [x.id, x]));
      const poolMap = new Map(p.map((x) => [x.id, x]));
      const synced = await syncAutoChainNames(c, nodeMap, poolMap);
      setPools(p);
      setChains(synced);
      setNodes(n);
      setSubscriptions(subs);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // G1: track the live exit / core context for the activation controls.
  // Fetching status (not just settings) gives us `running` — stopped cores
  // only need the generated config written, running ones must be restarted.
  useEffect(() => {
    let cancelled = false;
    const dispose = onProxySnapshot((status) => {
      if (cancelled || !status) return;
      setActive({
        currentNodeId: status.current_node_id ?? null,
        coreType: status.core_type ?? "singbox",
        running: status.running,
      });
    });
    void Promise.all([getSettings(), getProxyStatus()])
      .then(([s, p]) => {
        if (cancelled) return;
        setActive({
          currentNodeId: s.current_node_id ?? p.current_node_id ?? null,
          coreType: p.core_type ?? s.core_type ?? "singbox",
          running: p.running,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  /** I4: 逐跳收集链所需订阅并自动启用仍在禁用态的那些；返回被自动启用
   *  的订阅名（无需补齐时为空）。任一启用失败抛错中止。停用链出口不在此
   *  处理——回落普通节点，不禁用任何订阅。 */
  async function ensureChainSubscriptions(chainId: string): Promise<string[]> {
    const chain = chains.find((c) => c.id === chainId);
    if (!chain) return [];
    const required = requiredSubscriptionIds(chain, nodeById, poolById);
    if (required.size === 0) return [];
    const subs = await listSubscriptions();
    const nameOf = (id: string) => subs.find((s) => s.id === id)?.name ?? id;
    const disabled = [...required].filter(
      (id) => subs.find((s) => s.id === id)?.enabled === false,
    );
    if (disabled.length === 0) return [];
    // 非 Mix 下 activateSubscription 是互斥路径（启用一个禁用其余）——链
    // 跨订阅时绝不静默牺牲另一半，明确报错并提示开启 Mix。
    const mix = peekSettings()?.mix_mode ?? false;
    if (!mix && required.size > 1) {
      throw new Error(
        t("chain.autoEnableNeedsMix", {
          names: [...required].map(nameOf).join("、"),
        }),
      );
    }
    for (const id of disabled) {
      await activateSubscription(id);
    }
    // 启用路径可能因并发状态回落（如 MIX 下“最后一个启用订阅”保护），
    // 复查一遍：仍有缺即中止，报错点名。
    const after = await listSubscriptions();
    const stuck = disabled.filter(
      (id) => after.find((s) => s.id === id)?.enabled === false,
    );
    if (stuck.length > 0) {
      throw new Error(
        t("chain.autoEnableFailed", { names: stuck.map(nameOf).join("、") }),
      );
    }
    return disabled.map(nameOf);
  }

  /** I7: 复制链：后端新建链路（新 id）+ 名字加后缀，撞名时自动顺延
   *  序号；跳引用原样拷贝（node/pool id 引用，不复制成员实体）；名字
   *  标记为手动（不再跟随自动改名）。走现有 createChain 路径，不重启。 */
  async function copyChain(chain: ProxyChain) {
    const suffix = t("chain.copySuffix");
    const trimmed = chain.name.trim();
    const taken = new Set(chains.map((c) => c.name.toLowerCase()));
    let name = `${trimmed}${suffix}`;
    let i = 2;
    while (taken.has(name.toLowerCase())) {
      name = `${trimmed}${suffix}${i}`;
      i += 1;
    }
    // 后端限 64 字，加后缀可能超长——只裁名字本体，不动后缀。
    const base = Array.from(name).slice(0, 64).join("");
    const created = await createChain(base, chain.hops.map((h) => ({ ...h })), true);
    showNotice(t("chain.copiedNotice", { name: created.name }));
    await reload();
  }

  /** G1: select `chain:<id>` as the exit through the E2 channel — liveness
   *  checks and error text live in the backend (`select_chain_exit`), and
   *  chain outbounds only exist after a rebuild, so a running core always
   *  goes through the restart wait (no hot-swap in v1). Stopped cores just
   *  get the config written. Owned by the card's “启用为出口” control. */
  async function activateChainById(chainId: string) {
    if (activating) return;
    setActivating(chainId);
    setError(null);
    try {
      // I4: 先逐跳补齐链所需的订阅——没有它们链根本生成不出出口，后端
      // 只会报「节点不存在」的死引用。缺的订阅走既有 activateSubscription
      // 路径自动启用（Mix = toggle-on；非 Mix 会互斥地只留一个——链跨订阅时
      // 提示开 Mix，不静默把另一半禁掉）。任一订阅启用失败即中止本次链
      // 启用，报错点名；全部补齐后以成功 notice 列出被自动启用的订阅名。
      const autoEnabled = await ensureChainSubscriptions(chainId);
      if (autoEnabled.length > 0) {
        showNotice(t("chain.autoEnabledSubs", { names: autoEnabled.join("、") }));
      }
      await setCurrentNode(chainVirtualNodeId(chainId));
      if (active.running) {
        const result = await waitForCoreRestart();
        if (result !== "ready") {
          throw new Error(t("settings.coreSwitchWaitFailed"));
        }
      } else {
        await generateSingboxConfig();
      }
      setActive((a) => ({ ...a, currentNodeId: chainVirtualNodeId(chainId) }));
      // I8: 启用成功后自动测一次链出口，结果写进既有 exitProbe 结果区
      // （仅内存、不落盘）。仅在内核运行时触发——停核启用只写配置，
      // 直连读数会误导（与卡上探测按钮的置灰条件同口径）。
      if (active.running) void probeChainExit(chainId);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setActivating(null);
    }
  }

  /** 停用当前链出口：回落到普通节点（F 根因修复）。回落优先级、
   *  记忆节点与持久化全部由后端单源接管（`deactivate_chain_exit` →
   *  `select_current_node_serialized`）——运行中的 sing-box/mihomo 是
   *  热切 PUT，根本不重启；旧实现串行逐订阅拉 detail 再死等 30s
   *  重启事件（热路径永不发）是纯浪费。停核时与标准选点流同序预写
   *  配置；返回 null 表示当前出口已不是链（他处已停用），仅刷新。 */
  async function deactivateChainExit(chainId: string) {
    if (activating) return;
    setActivating(chainId);
    setError(null);
    try {
      const outcome = await deactivateChainExitCmd();
      if (outcome) {
        if (!active.running) {
          await generateSingboxConfig();
        } else if (outcome.restartNeeded) {
          const result = await waitForCoreRestart();
          if (result !== "ready") {
            throw new Error(t("settings.coreSwitchWaitFailed"));
          }
        }
        setActive((a) => ({ ...a, currentNodeId: outcome.nodeId }));
      }
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setActivating(null);
    }
  }

  /** H②：仅「使用中」链可点的出口探测。复用既有 check_exit_ip 诊断通道：
   *  探测经内核实际 HTTP 入口与路由规则发出，链为当前出口时读到的就是
   *  链出口的 IP/地区——不新开网络栈、不加依赖。停核时该通道走直连
   *  （不经过链），按钮置灰避免给出误导读数；失败红色原因显示在卡上。 */
  async function probeChainExit(chainId: string) {
    if (exitProbe?.busy) return;
    setExitProbe({ chainId, busy: true });
    try {
      const info = await checkExitIp();
      setExitProbe({ chainId, info, busy: false });
    } catch (err) {
      setExitProbe({
        chainId,
        error: typeof err === "string" ? err : String(err),
        busy: false,
      });
    }
  }

  async function onConfirmDelete() {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.kind === "pool") {
        await deletePool(confirmDelete.id);
      } else {
        await deleteChain(confirmDelete.id);
      }
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      setConfirmDelete(null);
      setError(typeof err === "string" ? err : String(err));
    }
  }

  return (
    <div className={embedded ? "settings-embed chain-embed" : "page chain-page"}>
      {!embedded && (
        <header className="page-header">
          <div>
            <h1>{t("chains.title")}</h1>
            <p className="page-desc">{t("chain.desc")}</p>
          </div>
        </header>
      )}
      {notice && <p className="muted chain-page-notice">{notice}</p>}

      <section className="chain-section">
        <div className="chain-section-head">
          <h2>{t("chain.poolsHeading")}</h2>
          <GlassButton onClick={() => setPoolEditor({ pool: null })}>
            {t("common.create")}
          </GlassButton>
        </div>
        {loading ? (
          <p className="muted">{t("common.loading")}</p>
        ) : pools.length === 0 ? (
          <p className="muted">{t("chain.noPoolsYet")}</p>
        ) : (
          <div className="card chain-pool-list">
            {pools.map((p, i) => (
              <PoolRow
                key={p.id}
                pool={p}
                keywordNodes={enabledNodes}
                subscriptions={subscriptions}
                usedByChains={poolChainCount.get(p.id) ?? 0}
                flipUp={i >= Math.ceil(pools.length / 2)}
                openMenuId={menuId}
                setOpenMenuId={setMenuId}
                onEdit={() => setPoolEditor({ pool: p })}
                onDelete={() => setConfirmDelete({ kind: "pool", id: p.id, name: p.name })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="chain-section">
        <div className="chain-section-head">
          <h2>{t("chain.chainsHeading")}</h2>
          <GlassButton onClick={() => setChainEditor({ chain: null })}>
            {t("common.create")}
          </GlassButton>
        </div>
        {loading ? (
          <p className="muted">{t("common.loading")}</p>
        ) : chains.length === 0 ? (
          <p className="muted">{t("chain.noChainsYet")}</p>
        ) : (
          <div className="chain-list">
            {chains.map((c, i) => {
              const virtualId = chainVirtualNodeId(c.id);
              const isActive = active.currentNodeId === virtualId;
              const isBusy = activating != null;
              const singbox = active.coreType === "singbox";
              // H③: any hop references a deleted node/pool — local check
              // against the loaded lists, no extra IPC. Empty-but-existing
              // pools are not dead (entities exist); liveness beyond
              // existence still errors on click from the backend.
              const dead = chainHasDeadHop(c, nodeIdSet, poolIdSet);
              // H②: reading for THIS card only — active chain, finished
              // probe, and not superseded by another chain's probe.
              const probeReading = (() => {
                if (
                  !isActive ||
                  !exitProbe ||
                  exitProbe.chainId !== c.id ||
                  exitProbe.busy
                ) {
                  return null;
                }
                if (exitProbe.error) return { text: exitProbe.error, err: true };
                const info = exitProbe.info;
                if (!info) return null;
                const region = info.countryCode
                  ? countryDisplayName(info.countryCode, locale)
                  : "";
                return {
                  text:
                    `${t("chain.probeIp")}: ${info.ip}` +
                    (region ? ` · ${region}` : "") +
                    (info.viaProxy ? "" : t("chain.probeDirect")),
                  err: false,
                };
              })();
              return (
                <div key={c.id} className="card chain-card">
                  <div className="chain-card-head">
                    <span className="chain-card-name" title={c.name}>
                      {c.name}
                    </span>
                    <span className="chain-card-badges">
                      <span className="chain-row-meta">
                        {t("chain.hopsCount", { n: c.hops.length })}
                      </span>
                      {dead && (
                        <span
                          className="chain-exit-btn chain-exit-dead"
                          aria-disabled="true"
                          title={t("chain.deadHint")}
                        >
                          {t("chain.dead")}
                        </span>
                      )}
                      {isActive ? (
                        <>
                          <span className="chain-exit-btn current" aria-disabled="true">
                            {t("chain.inUse")}
                          </span>
                          <button
                            type="button"
                            className="chain-exit-btn chain-exit-stop"
                            disabled={isBusy}
                            title={t("chain.stopExit")}
                            onClick={() => void deactivateChainExit(c.id)}
                          >
                            {activating === c.id
                              ? t("chain.activating")
                              : t("chain.stopExit")}
                          </button>
                          <button
                            type="button"
                            className="chain-exit-btn chain-exit-probe"
                            disabled={
                              isBusy ||
                              !active.running ||
                              (exitProbe?.chainId === c.id && exitProbe.busy)
                            }
                            title={
                              active.running
                                ? t("chain.probeExit")
                                : t("chain.probeStoppedHint")
                            }
                            onClick={() => void probeChainExit(c.id)}
                          >
                            {exitProbe?.chainId === c.id && exitProbe.busy
                              ? t("chain.probing")
                              : t("chain.probeExit")}
                          </button>
                        </>
                      ) : singbox ? (
                        <button
                          type="button"
                          className="chain-exit-btn"
                          disabled={isBusy || dead}
                          title={dead ? t("chain.deadHint") : undefined}
                          onClick={() => void activateChainById(c.id)}
                        >
                          {activating === c.id
                            ? t("chain.activating")
                            : t("chain.useAsExit")}
                        </button>
                      ) : (
                        <span
                          className="chain-exit-btn unavailable"
                          aria-disabled="true"
                          title={t("chain.exitSingboxOnlyHint")}
                        >
                          {t("chain.exitSingboxOnly")}
                        </span>
                      )}
                      <button
                        type="button"
                        className="icon-btn chain-card-diag"
                        aria-label={t("chain.diag")}
                        title={t("chain.diag")}
                        onClick={() => setDiagFor(c)}
                      >
                        <DiagGlyph />
                      </button>
                      <RowMenu
                        id={`chain-${c.id}`}
                        openId={menuId}
                        setOpenId={setMenuId}
                        flipUp={i >= Math.ceil(chains.length / 2)}
                        items={[
                          {
                            key: "edit",
                            label: t("common.edit"),
                            onClick: () => setChainEditor({ chain: c }),
                          },
                          {
                            key: "copy",
                            label: t("chain.copyChain"),
                            onClick: () => void copyChain(c),
                          },
                          {
                            key: "delete",
                            label: t("common.delete"),
                            danger: true,
                            onClick: () =>
                              setConfirmDelete({ kind: "chain", id: c.id, name: c.name }),
                          },
                        ]}
                      />
                    </span>
                  </div>
                  {probeReading && (
                    <p
                      className={`chain-exit-probe-result${probeReading.err ? " err" : ""}`}
                    >
                      {probeReading.text}
                    </p>
                  )}
                  {/* The pipeline IS the card: stations on a rail — entry
                      dot green, exit dot blue, arrows read client →
                      internet; pools marked by the layer glyph. */}
                  <div className="chain-stepper">
                    {c.hops.map((hop, i) => {
                      const { text, stale } = hopLabel(hop, nodeById, poolById);
                      const isPool = hop.kind === "pool";
                      // I6: node 跳名字旁显示该节点最近一次延迟（既有
                      // latency_ms 缓存，纯显示、不触发探测）；池跳没有
                      // 单一延迟，保持原样。
                      const latencyMs = isPool
                        ? null
                        : (nodeById.get(hop.node_id)?.latency_ms ?? null);
                      const last = i === c.hops.length - 1;
                      const role = i === 0 ? "entry" : last ? "exit" : "mid";
                      return (
                        <div key={i} className={`chain-station${stale ? " stale" : ""}`} title={text}>
                          <span className="chain-station-marker" aria-hidden="true">
                            {/* Ghost rails keep first/last dots centered over
                                their names while the visible rail stays
                                connected edge-to-edge. */}
                            <span className={`chain-rail${i > 0 ? "" : " ghost"}`} />
                            <span className={`chain-station-dot ${role}`} />
                            {last ? (
                              <span className="chain-rail ghost" />
                            ) : (
                              <span className="chain-rail">
                                <span className="chain-rail-arrow" />
                              </span>
                            )}
                          </span>
                          <span className="chain-station-name">
                            {isPool && (
                              <span className="chain-flow-glyph" aria-hidden="true">
                                <PoolGlyph />
                              </span>
                            )}
                            {text}
                            {latencyMs != null && latencyMs > 0 && (
                              <span className="chain-station-latency">{latencyMs} ms</span>
                            )}
                          </span>
                          <span className="chain-flow-type">
                            {isPool ? t("chain.pool") : t("rules.pickNode")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {poolEditor && (
        <PoolEditorModal
          pool={poolEditor.pool}
          nodes={nodes}
          keywordNodes={enabledNodes}
          subscriptions={subscriptions}
          onClose={() => setPoolEditor(null)}
          onSaved={(pruned) => {
            // 追加1：悬空引用自愈提示——剔除计数随保存结果返回。
            if (pruned > 0) {
              showNotice(
                t("chain.poolPruned", {
                  name: poolEditor.pool?.name ?? poolEditor.pool?.id ?? "",
                  n: pruned,
                }),
                3200,
              );
            }
            setPoolEditor(null);
            void reload();
          }}
        />
      )}
      {chainEditor && (
        <ChainEditorModal
          chain={chainEditor.chain}
          nodes={nodes}
          keywordNodes={enabledNodes}
          pools={pools}
          onClose={() => setChainEditor(null)}
          onShareText={editingChain ? () => void copyChainText(editingChain) : null}
          onShareYaml={editingChain ? () => void copyChainMihomoYaml(editingChain) : null}
          onSaved={() => {
            setChainEditor(null);
            void reload();
          }}
        />
      )}
      {diagFor && <ChainDiagModal chain={diagFor} onClose={() => setDiagFor(null)} />}
      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal">
            <header className="modal-header">
              <h2>{t("common.confirm")}</h2>
            </header>
            <div className="modal-body">
              <p>
                {confirmDelete.kind === "pool"
                  ? t("chain.confirmDeletePool", { name: confirmDelete.name })
                  : t("chain.confirmDeleteChain", { name: confirmDelete.name })}
              </p>
            </div>
            <footer className="modal-footer">
              <GlassButton onClick={() => setConfirmDelete(null)}>
                {t("common.cancel")}
              </GlassButton>
              <GlassButton variant="danger" onClick={() => void onConfirmDelete()}>
                {t("common.delete")}
              </GlassButton>
            </footer>
          </div>
        </div>
      )}
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
    </div>
  );
}
