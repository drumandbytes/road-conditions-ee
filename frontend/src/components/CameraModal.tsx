import { useEffect, useState } from "preact/hooks";
import { fetchCameraImage } from "../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
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
    };
  };
}

export function CameraModal({ cameraId, cameraName, onClose, t }: CameraModalProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    setState({ status: "loading" });
    fetchCameraImage(cameraId)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 402) {
          setState({ status: "paywalled" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cameraId]);

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

        {state.status === "ready" && <img class="camera-modal-image" src={state.objectUrl} alt={cameraName} />}
      </div>
    </div>
  );
}
