import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";

/**
 * PrintFlex's own buttons, checkboxes and switches. Polaris web components
 * cannot be recoloured from outside their shadow roots, so the admin uses
 * these instead and keeps the brand orange everywhere. They are native
 * elements: forms post the same names, slots and invoker commands work.
 */

const ICONS: Record<string, string> = {
  "chevron-down": "▾",
  "chevron-up": "▴",
  plus: "+",
  delete: "✕",
  check: "✓",
  clipboard: "⧉",
  print: "⎙",
};

export interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "variant" | "slot" | "tone" | "command"> {
  variant?: "primary" | "secondary" | "tertiary" | "auto";
  tone?: "critical" | "auto" | "neutral";
  href?: string;
  target?: string;
  loading?: boolean;
  icon?: string;
  type?: "button" | "submit";
  commandFor?: string;
  command?: string;
  slot?: string;
  children?: ReactNode;
}

export function Btn({ variant = "secondary", tone, href, target, loading, icon, type = "button", commandFor, command, className, children, disabled, ...rest }: BtnProps) {
  const cls = ["pf-btn", `pf-btn--${variant === "auto" ? "secondary" : variant}`, tone === "critical" ? "pf-btn--critical" : "", className ?? ""].filter(Boolean).join(" ");
  const glyph = icon && ICONS[icon] ? <span className="pf-btn__icon" aria-hidden="true">{ICONS[icon]}</span> : null;
  const body = (
    <>
      {loading ? <span className="pf-btn__spin" aria-hidden="true" /> : glyph}
      {children}
    </>
  );
  if (href && !disabled) {
    const internal = href.startsWith("/");
    const anchorProps = rest as unknown as Record<string, unknown>;
    return internal ? (
      <Link to={href} className={cls} {...anchorProps}>{body}</Link>
    ) : (
      <a href={href} target={target} rel={target === "_blank" ? "noreferrer" : undefined} className={cls} {...anchorProps}>{body}</a>
    );
  }
  // commandfor/command are the HTML invoker attributes Polaris overlays listen for.
  const invoker = commandFor ? ({ commandfor: commandFor, command } as Record<string, string | undefined>) : {};
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...invoker} {...rest}>
      {body}
    </button>
  );
}

export interface CheckProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  indeterminate?: boolean;
}

export const Check = forwardRef<HTMLInputElement, CheckProps>(function Check({ label, indeterminate, className, ...rest }, ref) {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className={["pf-check", className ?? ""].join(" ").trim()}>
      <input
        type="checkbox"
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        {...rest}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
});

export interface SwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  details?: ReactNode;
}

export function Switch({ label, details, className, ...rest }: SwitchProps) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- the title and details spans are the label text
    <label className={["pf-switch", className ?? ""].join(" ").trim()}>
      <input type="checkbox" {...rest} />
      <span>
        <span className="t">{label}</span>
        {details ? <span className="d">{details}</span> : null}
      </span>
    </label>
  );
}
