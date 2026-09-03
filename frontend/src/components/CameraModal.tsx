import { useEffect, useState } from "preact/hooks";
import { fetchCameraImage } from "../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string; updatedAt: number }
  | { status: "paywalled" }
  | { status: "error" };

interface CameraModalProps {
  cameraId: string;
  cameraName: string;
  onClose: () => void;
  t: {
    cameraModal: {
      close: string;
      loading: string;
      paywalled: string;
      error: string;
      updated: string;
      updatedJustNow: string;
    };
  };
}

// Matches api-worker's own edge-cache TTL for this image (see cameras.ts) — polling faster
// than that would just re-fetch the same cached bytes, not get anything fresher.
const REFRESH_INTERVAL_MS = 60_000;

export function CameraModal({ cameraId, cameraName, onClose, t }: CameraModalProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Ticks once a second purely to re-render the "updated Xs ago" caption — the timestamp
  // itself lives in state, this just forces the relative-time string to recompute.
  const [, setTick] = useState(0);

  useEffect(() => {
    let currentObjectUrl: string | undefined;
    let cancelled = false;

    function load() {
      // A backgrounded tab keeps its interval running but has nothing to show — skip the
      // fetch (worker proxy + upstream hit) until it's visible again; the visibilitychange
      // listener below refreshes on return.
      if (document.hidden) return;
      fetchCameraImage(cameraId)
        .then(async (res) => {
          if (cancelled) return;
          if (res.status === 402) {
            setState({ status: "paywalled" });
            return;
          }
          if (!res.ok) {
            // A refresh that fails shouldn't blank out a perfectly good image already on
            // screen — only surface as an error if this was the first load.
            setState((current) => (current.status === "ready" ? current : { status: "error" }));
            return;
          }
          const blob = await res.blob();
          const nextUrl = URL.createObjectURL(blob);
          const previousUrl = currentObjectUrl;
          currentObjectUrl = nextUrl;
          setState({ status: "ready", objectUrl: nextUrl, updatedAt: Date.now() });
          // Only after the new image is committed to state — revoking sooner risks the <img>
          // briefly pointing at a dead blob URL mid-swap.
          if (previousUrl) URL.revokeObjectURL(previousUrl);
        })
        .catch(() => {
          if (!cancelled) setState((current) => (current.status === "ready" ? current : { status: "error" }));
        });
    }

    setState({ status: "loading" });
    load();
    const refreshInterval = setInterval(load, REFRESH_INTERVAL_MS);
    const tickInterval = setInterval(() => setTick((n) => n + 1), 1000);

    function onVisible() {
      if (!document.hidden) load();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
      clearInterval(tickInterval);
      document.removeEventListener("visibilitychange", onVisible);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [cameraId]);

  function formatUpdated(updatedAt: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
    if (seconds < 5) return t.cameraModal.updatedJustNow;
    return `${t.cameraModal.updated} ${seconds}s`;
  }

  return (
    <div class="camera-modal-overlay" onClick={onClose}>
      <div class="camera-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="camera-modal-close" onClick={onClose} aria-label={t.cameraModal.close}>
          ×
        </button>
        <h2>{cameraName}</h2>

        {state.status === "loading" && (
          <div class="camera-modal-status">
            <div class="camera-modal-spinner" />
          </div>
        )}

        {state.status === "paywalled" && (
          <div class="camera-modal-status">
            <svg
              class="camera-modal-status-icon"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <p class="camera-modal-status-text">{t.cameraModal.paywalled}</p>
          </div>
        )}

        {state.status === "error" && (
          <div class="camera-modal-status">
            <svg
              class="camera-modal-status-icon"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <p class="camera-modal-status-text">{t.cameraModal.error}</p>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <img class="camera-modal-image" src={state.objectUrl} alt={cameraName} />
            <p class="camera-modal-updated">
              <span class="camera-modal-live-dot" aria-hidden="true" />
              {formatUpdated(state.updatedAt)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
