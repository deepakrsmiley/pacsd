export default function Logo({ framed = false, className = "" }) {
  return (
    <img
      src={framed ? "/gms-logo-ambient.png" : "/gms-mark-ambient.png"}
      alt="Galactic Medical Systems"
      className={`object-contain ${className}`}
    />
  );
}
