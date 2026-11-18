import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { getSubscription } from "../api";
import { useI18n } from "../i18n";
import { copyNodeShareText } from "../nodeShare";
import type { SubscriptionView } from "../types";
import { GlassButton } from "./GlassButton";

interface Props {
  item: SubscriptionView | null;
  onClose: () => void;
}

function errorText(error: unknown) {
  return typeof error === "string" ? error : String(error);
}

/**
 * Renders a subscription URL as a local QR canvas — the same shape and styles
 * as NodeShareModal (this is text-to-canvas, never routed through a service;
 * the URL is fetched only when the dialog is opened, never prefetched while
 * the list renders). The payload is the full URL by design: importing it on
 * another device requires the credentials, so nothing gets masked — the
 * warning line carries the handling advice instead.
 */
export function SubShareModal({ item, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setUrl(null);
    setError(null);
    setCopied(false);
    void getSubscription(item.id)
      .then((detail) => {
        if (cancelled) return;
        if (detail.url) setUrl(detail.url);
        else setError(t("config.subShareNoUrl"));
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
    // The label lookup is stable per locale; the fetch may only re-run when
    // the dialog targets a different subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!url || !canvas) return;
    let cancelled = false;
    void QRCode.toCanvas(canvas, url, {
      width: 224,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#101318", light: "#ffffff" },
    }).catch((reason) => {
      if (!cancelled) setError(errorText(reason));
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!item) return null;

  async function copy() {
    if (!url) return;
    try {
      await copyNodeShareText(url);
      setCopied(true);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal node-share-modal" role="dialog" aria-modal="true" aria-labelledby="sub-share-title">
        <header className="modal-header">
          <div>
            <h2 id="sub-share-title">{t("config.subShareTitle")}</h2>
            <p className="hint" title={item.name}>{item.name}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>×</button>
        </header>
        <div className="modal-body node-share-body">
          <p className="node-share-warning">{t("config.subShareWarning")}</p>
          {error ? (
            <div className="node-share-error">{error}</div>
          ) : !url ? (
            <div className="muted">{t("nodes.shareLoading")}</div>
          ) : (
            <>
              <div className="node-share-qr"><canvas ref={canvasRef} /></div>
              <textarea className="node-share-uri" readOnly value={url} aria-label={t("nodes.contextCopyLink")} />
            </>
          )}
        </div>
        <footer className="modal-footer">
          <GlassButton onClick={onClose}>{t("common.close")}</GlassButton>
          <GlassButton variant="primary" disabled={!url} onClick={() => void copy()}>
            {copied ? t("nodes.shareCopied") : t("nodes.shareCopy")}
          </GlassButton>
        </footer>
      </div>
    </div>
  );
}
