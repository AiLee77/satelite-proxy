//! Tauri commands for the Proxy Chain feature: named node pools and the
//! multi-hop chains built from them (see `config::builder`'s
//! `build_pool_selectors` / `build_chain_outbounds`).

use crate::domain::{ChainHop, NodePool, PoolMode, ProxyChain, ProxyNode};
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, State};

use super::config::wire_node;

/// Queue one globally debounced restart — mirrors `rules.rs::apply_running`.
/// Pool/chain edits change the generated outbounds the same way rule edits
/// do, so they need the same debounced-restart contract.
fn apply_running(app: &AppHandle) {
    crate::rule_apply::request_restart(app.clone(), Vec::new());
}

#[tauri::command(async)]
pub fn list_pools(state: State<'_, AppState>) -> Result<Vec<NodePool>, String> {
    state
        .with_store(|store| Ok(store.pools.clone()))
        .map_err(|e| e.to_string())
}

/// Node listing for the pool/chain editors: every stored node from every
/// subscription, not just enabled ones. Pools and chains hold node-ID
/// references that routinely cross subscriptions — build a pool from sub A,
/// switch the active sub to B (MIX off) and the pool must still list and
/// keep A's nodes — so the editing UI needs the full universe. The
/// enabled-subscription node pages keep listing via `list_all_nodes`.
///
/// `enabled` mirrors exactly what a config build consults (same predicate as
/// `AppStore::enabled_nodes`, i.e. subscription enabled AND it feeds nodes
/// into the generated config): UI previews that must match runtime keyword
/// semantics — keyword pool membership, smart-style keyword filtering over
/// the hop cards — filter on it client-side instead of widening the runtime
/// semantic here.
#[derive(Debug, Serialize)]
pub struct ChainListedNode {
    #[serde(flatten)]
    pub node: ProxyNode,
    pub subscription_id: String,
    pub subscription_name: String,
    pub favorite: bool,
    /// False when the owning subscription is currently disabled: the node is
    /// editable/selectable inside pools and chains, but keyword pools and
    /// config-build keyword filtering only match enabled-subscription nodes.
    pub enabled: bool,
}

#[tauri::command(async)]
pub fn list_chain_nodes(state: State<'_, AppState>) -> Result<Vec<ChainListedNode>, String> {
    state
        .with_store(|store| {
            let names: std::collections::HashMap<&str, &str> = store
                .subscriptions
                .iter()
                .map(|sub| (sub.id.as_str(), sub.name.as_str()))
                .collect();
            let enabled_subs: std::collections::HashSet<&str> = store
                .subscriptions
                .iter()
                .filter(|sub| sub.enabled && sub.source.contributes_nodes())
                .map(|sub| sub.id.as_str())
                .collect();
            Ok(store
                .ordered_nodes()
                .into_iter()
                .map(|stored| {
                    let id = stored.node.id.clone();
                    ChainListedNode {
                        subscription_id: stored.subscription_id.clone(),
                        subscription_name: names
                            .get(stored.subscription_id.as_str())
                            .copied()
                            .unwrap_or("")
                            .to_string(),
                        favorite: store.favorite_nodes.contains(&id),
                        enabled: enabled_subs.contains(stored.subscription_id.as_str()),
                        node: wire_node(stored.node.clone()),
                    }
                })
                .collect())
        })
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn create_pool(
    state: State<'_, AppState>,
    name: String,
    mode: PoolMode,
) -> Result<NodePool, String> {
    state
        .with_store_mut(|store| store.create_pool(&name, mode))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn update_pool(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    mode: PoolMode,
) -> Result<NodePool, String> {
    let pool = state
        .with_store_mut(|store| store.update_pool(&id, &name, mode))
        .map_err(|e| e.to_string())?;
    // A pool's membership feeds every chain/rule that references it —
    // always worth a restart, same as editing a rule set's keyword filter.
    apply_running(&app);
    Ok(pool)
}

#[tauri::command(async)]
pub fn delete_pool(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .with_store_mut(|store| store.delete_pool(&id))
        .map_err(|e| e.to_string())?;
    apply_running(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn list_chains(state: State<'_, AppState>) -> Result<Vec<ProxyChain>, String> {
    state
        .with_store(|store| Ok(store.chains.clone()))
        .map_err(|e| e.to_string())
}

/// Rule-set references per chain id (set-level pin or any single rule,
/// deduped per set) — mirrors `delete_chain`'s guard so the list page can
/// show "used by N rule sets" before a delete is attempted.
#[tauri::command(async)]
pub fn list_chain_usage(
    state: State<'_, AppState>,
) -> Result<std::collections::BTreeMap<String, Vec<String>>, String> {
    state
        .with_store(|store| Ok(store.chain_rule_usage()))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn create_chain(
    state: State<'_, AppState>,
    name: String,
    hops: Vec<ChainHop>,
) -> Result<ProxyChain, String> {
    state
        .with_store_mut(|store| store.create_chain(&name, hops))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn update_chain(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    hops: Vec<ChainHop>,
) -> Result<ProxyChain, String> {
    let chain = state
        .with_store_mut(|store| store.update_chain(&id, &name, hops))
        .map_err(|e| e.to_string())?;
    apply_running(&app);
    Ok(chain)
}

#[tauri::command(async)]
pub fn delete_chain(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .with_store_mut(|store| store.delete_chain(&id))
        .map_err(|e| e.to_string())?;
    apply_running(&app);
    Ok(())
}

/// Export one chain as a standalone mihomo (Clash Meta) config that
/// externally replays the same hop semantics via `dialer-proxy` — for
/// users who run mihomo somewhere else and just want the chain wiring.
/// Node resolution deliberately uses the chain-aware node universe
/// (enabled prefix + nodes referenced by chains/explicit pools), so a
/// chain whose entry hop sits in a currently-disabled subscription still
/// exports — keyword pools are unrelated here (export rejects pool hops
/// outright, see `build_mihomo_chain_export`).
#[tauri::command(async)]
pub fn export_chain_mihomo_yaml(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    state
        .with_store(|store| {
            let chain = store
                .chains
                .iter()
                .find(|c| c.id == id)
                .cloned()
                .ok_or_else(|| crate::error::AppError::Config(format!("链 {id} 不存在")))?;
            let nodes = store.enabled_nodes_with_chain_refs();
            crate::config::build_mihomo_chain_export(&nodes, &chain)
        })
        .map(|built| built.yaml)
        .map_err(|e| e.to_string())
}

/// Human-readable chain text (`入口 → … → 出口` with node/pool names) for
/// clipboard export — the hand-shareable summary of a chain. Reuses the
/// editor's node universe so stale ids surface as `[missing: <id8>]` rather
/// than an empty hop.
#[tauri::command(async)]
pub fn export_chain_text(state: State<'_, AppState>, id: String) -> Result<String, String> {
    state
        .with_store(|store| {
            let chain = store
                .chains
                .iter()
                .find(|c| c.id == id)
                .cloned()
                .ok_or_else(|| crate::error::AppError::Config(format!("链 {id} 不存在")))?;
            let nodes = store.enabled_nodes_with_chain_refs();
            let node_by_id: std::collections::HashMap<&str, &str> = nodes
                .iter()
                .map(|n| (n.id.as_str(), n.name.as_str()))
                .collect();
            let pools: std::collections::HashMap<&str, &str> = store
                .pools
                .iter()
                .map(|p| (p.id.as_str(), p.name.as_str()))
                .collect();
            let mut out = String::new();
            if chain.hops.is_empty() {
                return Ok(chain.name);
            }
            for (idx, hop) in chain.hops.iter().enumerate() {
                if idx > 0 {
                    out.push_str(" → ");
                }
                match hop {
                    ChainHop::Pool { pool_id } => {
                        out.push_str(&format!(
                            "[池] {}",
                            pools
                                .get(pool_id.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| short_missing(pool_id))
                        ));
                    }
                    ChainHop::Node { node_id } => {
                        out.push_str(&format!(
                            "[{}] {}",
                            if idx == 0 {
                                "入口"
                            } else if idx == chain.hops.len() - 1 {
                                "出口"
                            } else {
                                "中转"
                            },
                            node_by_id
                                .get(node_id.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| short_missing(node_id))
                        ));
                    }
                }
            }
            Ok(format!("{}: {out}", chain.name))
        })
        .map_err(|e| e.to_string())
}

fn short_missing(id: &str) -> String {
    format!("[missing: {}]", &id[..id.len().min(8)])
}

/// Probe every hop of one chain through the live Clash delay API — solo
/// latency per hop plus chain-prefix latency (the last hop's prefix is the
/// whole chain). Localizes which hop breaks a multi-hop chain; requires the
/// sing-box core to be running (chain-local outbound tags only exist there).
/// Also performs real-world exit verification: an ip.sb round-trip through
/// the whole chain, plus the actual exit IP via the app's loopback
/// diagnostics inbound (no user rule needed).
#[tauri::command]
pub async fn diagnose_chain(
    state: State<'_, AppState>,
    chain_id: String,
) -> Result<crate::services::chain_diag::ChainDiagnosis, String> {
    let (chain, pools, nodes, core_kind, probe_url, locale) = state
        .with_store(|store| {
            Ok((
                store.chains.iter().find(|c| c.id == chain_id).cloned(),
                store.pools.clone(),
                // Chain hops routinely reference nodes from disabled
                // subscriptions (MIX off) — the diagnosis must resolve them
                // the same way the config build does, or every hop of such a
                // chain would read as missing even while the running config
                // actually carries it.
                store.enabled_nodes_with_chain_refs(),
                crate::core::CoreKind::parse(&store.settings.core_type),
                store.settings.probe_url.clone(),
                store.settings.locale.clone(),
            ))
        })
        .map_err(|e| e.to_string())?;
    let chain = chain.ok_or_else(|| "链路不存在".to_string())?;
    if core_kind != crate::core::CoreKind::SingBox {
        return Err("链路诊断仅在 sing-box 内核下可用（其余内核不支持代理链）".into());
    }
    let api = state
        .lock_runtime()
        .clash_api_clone()
        .ok_or_else(|| "内核未运行，请先启动代理后再诊断".to_string())?;
    // Belt-and-braces outer cap: the inner probes are individually bounded,
    // but this guarantees the invoke always settles even if something
    // unexpected stalls the whole future.
    match tokio::time::timeout(
        std::time::Duration::from_secs(35),
        crate::services::chain_diag::diagnose(api, chain, pools, nodes, probe_url, 6000, locale),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(_) => Err("诊断超时：部分探测长时间无响应，请检查内核与节点状态".into()),
    }
}
