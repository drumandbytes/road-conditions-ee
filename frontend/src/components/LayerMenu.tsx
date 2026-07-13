import { useState } from "preact/hooks";
import type { LayerId, MarkerLabelsT } from "./Map";

// Colors duplicated from Map.tsx's CLUSTER_LAYER_PAINT — see InfoPanel.tsx's LEGEND_ROWS for
// why this isn't imported directly (avoids coupling this small component to Map.tsx's module,
// which pulls in maplibre-gl).
const LAYER_ROWS: { id: LayerId; color: string }[] = [
  { id: "weatherStations", color: "#2e9bff" },
  { id: "cameras", color: "#8e44ad" },
  { id: "hazards", color: "#ff3b30" },
  { id: "restrictions", color: "#e67e22" },
  { id: "vms", color: "#16a085" },
];

interface LayerMenuProps {
  openButtonLabel: string;
  markerLabelsT: MarkerLabelsT;
  visibleLayers: Record<LayerId, boolean>;
  onToggleLayer: (id: LayerId, visible: boolean) => void;
}

// A separate, lightweight floating control — deliberately not part of the Info panel's
// legend/tabs flow. Toggling a layer is a quick, frequent map interaction; routing it through
// the full info-overlay (locale switcher, tabs, legend descriptions, about/support links) was
// too much friction for something this small.
export function LayerMenu({ openButtonLabel, markerLabelsT, visibleLayers, onToggleLayer }: LayerMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div class="layer-menu">
      <button
        type="button"
        class="layer-menu-button"
        onClick={() => setOpen((current) => !current)}
        aria-label={openButtonLabel}
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path d="M12 3 3 8l9 5 9-5-9-5Z" fill="currentColor" />
          <path d="m3 12 9 5 9-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="m3 16 9 5 9-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div class="layer-menu-scrim" onClick={() => setOpen(false)} />
          <div class="layer-menu-popover">
            {LAYER_ROWS.map((row) => (
              <label key={row.id} class="layer-menu-row">
                <span class="layer-menu-dot" style={{ background: row.color }} />
                <span class="layer-menu-label">{markerLabelsT[row.id]}</span>
                <input
                  type="checkbox"
                  checked={visibleLayers[row.id] !== false}
                  onChange={(e) => onToggleLayer(row.id, (e.target as HTMLInputElement).checked)}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
