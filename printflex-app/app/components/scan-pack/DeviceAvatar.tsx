/**
 * Initials in a soft tint, so a bench is recognisable at a glance in the
 * device list and the scan history. The colour comes from the device name, so
 * "Bench 2" is the same colour everywhere and on every visit.
 */
const TINTS: Array<{ bg: string; fg: string }> = [
  { bg: "#fdefe3", fg: "#a84206" },
  { bg: "#e0f0ff", fg: "#00527c" },
  { bg: "#e3f7ea", fg: "#0c5132" },
  { bg: "#f1e8ff", fg: "#5b2a9e" },
  { bg: "#fff4d6", fg: "#6b4a00" },
  { bg: "#ffe4ec", fg: "#8e1f4b" },
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function tint(name: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function DeviceAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const { bg, fg } = tint(name);
  return (
    <span className={`pf-avatar pf-avatar--${size}`} style={{ background: bg, color: fg }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Device name in bold with the staff label beside it, as one cell. */
export function DeviceLabel({ name, staffLabel, size = "md" }: { name: string; staffLabel: string | null; size?: "sm" | "md" }) {
  return (
    <span className="pf-device">
      <DeviceAvatar name={name} size={size} />
      <span className="pf-device__text">
        <span className="pf-device__name">{name}</span>
        {staffLabel ? <span className="pf-device__staff">{staffLabel}</span> : null}
      </span>
    </span>
  );
}
