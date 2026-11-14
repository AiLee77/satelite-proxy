import type { NodePool, PoolMode, ProxyNode } from "./types";

/** "Subscription currently enabled" mirror for the chain/pool editors.
 *
 * `list_chain_nodes` returns every stored node (pools/chains hold node-ID
 * references that cross subscriptions — the editor needs the full universe),
 * and marks each entry with `enabled`, computed from the same predicate the
 * config build consults (`store.enabled_nodes`): subscription enabled && it
 * contributes nodes. Legacy node lists without the field stay eligible. */
export function nodeEnabledInBuild(node: ProxyNode): boolean {
  return node.enabled !== false;
}

/** Enabled-subscription universe — the ONLY node set keyword pools and
 * keyword-style runtime matching may pick members from. Keyword semantics
 * stay enabled-only by design; crossing subscriptions requires an explicit
 * pool. */
export function enabledUniverse(nodes: ProxyNode[]): ProxyNode[] {
  return nodes.filter(nodeEnabledInBuild);
}

/** Whitespace-separated keyword list → trimmed non-empty tokens. */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Client-side mirror of a keyword pool's include/exclude name filter —
 * display-only (count/dot previews); the backend re-evaluates at build time
 * with the same enabled-only universe. */
export function poolKeywordMatch(name: string, include: string[], exclude: string[]): boolean {
  const n = name.toLowerCase();
  if (include.length && !include.some((k) => n.includes(k.toLowerCase()))) return false;
  return !exclude.some((k) => n.includes(k.toLowerCase()));
}

/** Preview members for one pool against a node list, with the editor's
 * viewing semantics:
 *  - `explicit` pools list EVERY referenced node (any subscription, stale
 *    ids resolved as far as the node list allows) — membership is fixed
 *    node-ID references, not re-filtered at build time;
 *  - `keyword` pools match only the enabled-subscription universe.
 */
export function chainPoolPreviewMembers(
  pool: Pick<NodePool, "mode">,
  nodes: ProxyNode[],
): Array<{ node: ProxyNode; stale: false } | { node: null; stale: true }> {
  const mode: PoolMode = pool.mode;
  if (mode.mode === "explicit") {
    return mode.node_ids.map((id) => {
      const node = nodes.find((n) => n.id === id);
      return node ? { node, stale: false } : { node: null, stale: true };
    });
  }
  return enabledUniverse(nodes)
    .filter((n) => poolKeywordMatch(n.name, mode.include, mode.exclude))
    .map((n) => ({ node: n, stale: false }));
}
