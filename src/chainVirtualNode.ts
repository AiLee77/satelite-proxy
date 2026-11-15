/**
 * Virtual chain entries (v2rayN-style "chain as exit").
 *
 * The backend (`commands::config::chain_virtual_listed_nodes`) merges one
 * synthetic listed node per stored proxy chain into the node listings when
 * the primary core is sing-box and the runtime source is generated:
 *
 *   - id    = `chain:<chain_id>` (the `chain:` namespace can never collide
 *             with real node ids — those are 32-char hex digests)
 *   - name  = chain name
 *   - chain_hops set as the explicit wire marker
 *
 * Selecting a virtual entry as the current node makes the chain's exit the
 * main selector's outbound (applied on the next core start/restart — there
 * is no hot-swap in v1). Chain entries are not real nodes: never latency-
 * test, favorite, edit, share, drag-sort, or batch-operate them; they are
 * managed on the Chains page.
 */

/** Id namespace prefix — mirrors `domain::chain::CHAIN_NODE_ID_PREFIX`. */
export const CHAIN_NODE_ID_PREFIX = "chain:";

/** Mirrors `domain::chain::chain_virtual_node_id` — the listed-node id
 *  selecting a chain as exit goes by (`setCurrentNode("chain:" + id)`).
 *  Real node ids are 32-char hex digests, so this never collides. */
export function chainVirtualNodeId(chainId: string): string {
  return `${CHAIN_NODE_ID_PREFIX}${chainId}`;
}

/** True for virtual chain entry ids (`chain:<chain_id>`). */
export function isChainVirtualId(id: string): boolean {
  return id.startsWith(CHAIN_NODE_ID_PREFIX);
}

/** True when a listed node is a virtual chain entry. This is the ONLY
 *  sanctioned check — the placeholder protocol/server fields carry no
 *  meaning and must never be branched on or displayed. */
export function isChainEntry(node: { chain_hops?: number | null }): boolean {
  return node.chain_hops != null;
}
