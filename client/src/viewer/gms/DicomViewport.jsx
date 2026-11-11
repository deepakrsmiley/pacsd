export default function DicomViewport({ layoutName, count, activeSlot, setSlotRef, onActivate, renderOverlay }) {
  return (
    <div className="gms2-grid" data-layout={layoutName}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={`${layoutName}-${index}`}
          className="gms2-viewport"
          data-active={index === activeSlot}
          ref={(node) => setSlotRef(index, node)}
          onMouseDown={() => onActivate(index)}
        >
          {renderOverlay(index)}
        </div>
      ))}
    </div>
  );
}

export function DicomOverlay({ patient, study, series, instance, snapshot, markers, derived, plane }) {
  const slice = snapshot.count ? `${snapshot.slice + 1}/${snapshot.count}` : "";
  const matrix = instance?.columns && instance?.rows ? `${instance.columns} × ${instance.rows}` : "";
  const zoom = `${Math.round((snapshot.zoom || 1) * 100)}%`;
  const width = Number.isFinite(snapshot.windowWidth) ? Math.round(snapshot.windowWidth) : (Number.isFinite(instance?.windowWidth) ? Math.round(instance.windowWidth) : "—");
  const level = Number.isFinite(snapshot.windowCenter) ? Math.round(snapshot.windowCenter) : (Number.isFinite(instance?.windowCenter) ? Math.round(instance.windowCenter) : "—");
  return (
    <>
      <div className="gms2-overlay">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="font-semibold">{patient?.name || ""}</div>
            <div>ID: {patient?.mrn || "—"}</div>
            <div>Acc: {study?.accession || "—"}</div>
            <div>{[series?.modality || study?.modality, study?.description].filter(Boolean).join(" ")}{series?.description ? ` (${series.description})` : ""}</div>
            <div>Se: {series?.seriesNumber || "—"} Im: {slice || "—"}{plane ? ` · ${plane}` : ""}</div>
          </div>
          <div className="text-right">
            {derived && <div className="mb-1 text-amber-200">Derived reconstruction</div>}
            <div>{instance?.institution || ""}</div>
            <div>{instance?.manufacturer || ""}</div>
          </div>
        </div>
        <div className="flex items-end justify-between gap-6">
          <div>
            <div>W: {width} L: {level}</div>
            <div>Zoom: {zoom}</div>
          </div>
          <div className="text-right">
            <div>{slice}</div>
            <div>{matrix}</div>
          </div>
        </div>
      </div>
      {markers && (
        <>
          <span className="gms2-orientation" style={{ left: 8, top: "50%" }}>{markers.left}</span>
          <span className="gms2-orientation" style={{ right: 8, top: "50%" }}>{markers.right}</span>
          <span className="gms2-orientation" style={{ top: 36, left: "50%" }}>{markers.top}</span>
          <span className="gms2-orientation" style={{ bottom: 8, left: "50%" }}>{markers.bottom}</span>
        </>
      )}
    </>
  );
}
