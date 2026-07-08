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
        {state.status === "loading" && <p>{t.cameraModal.loading}</p>}
        {state.status === "paywalled" && <p>{t.cameraModal.paywalled}</p>}
        {state.status === "error" && <p>{t.cameraModal.error}</p>}
        {state.status === "ready" && <img class="camera-modal-image" src={state.objectUrl} alt={cameraName} />}
      </div>
    </div>
  );
}
