import { useEffect, useState } from "react";
import { getProxyStatus, onProxySnapshot, peekProxyStatus, peekSettings } from "../api";

/**
 * 追踪当前运行来源（"generated" | "singbox:<id>"）。
 * 模块快照种子 + 代理状态快照订阅 + 一次兜底拉取：
 * 配置切换经核心重启 → watchdog 事件 → 快照广播即时生效，无需额外轮询。
 * 无 Tauri 环境（浏览器夹具）或异常回包时静默保留初始值，不覆盖为未知来源。
 */
export function useRuntimeSource(): string {
  const [source, setSource] = useState<string>(
    () =>
      peekProxyStatus()?.runtime_source ??
      peekSettings()?.runtime_source ??
      "generated",
  );

  useEffect(() => {
    let disposed = false;
    // 仅接受有效字符串；夹具回包（undefined/对象）不得清掉冷启动种子。
    const sync = (value: unknown) => {
      if (disposed || typeof value !== "string" || !value) return;
      setSource((previous) => (previous === value ? previous : value));
    };
    const dispose = onProxySnapshot((status) => sync(status?.runtime_source));
    void getProxyStatus()
      .then((status) => sync(status?.runtime_source))
      .catch(() => {});
    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  return source;
}
