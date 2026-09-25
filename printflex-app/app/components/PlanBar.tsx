import { Btn } from "./ui";
export interface PlanBarProps {
  planId: string;
  planName: string;
  planOptions: Array<{ id: string; name: string }>;
  pills: string[];
  used: number;
  limit: number | null;
  daysRemaining: number;
  promptUpgrade: boolean;
}

/**
 * The plan bar: current plan in a segmented switch, what it includes, this
 * period's usage, and the way to Plans & billing. Same markup on every page.
 */
export function PlanBar({ planId, planName, planOptions, pills, used, limit, daysRemaining, promptUpgrade }: PlanBarProps) {
  const ratio = limit ? used / limit : 0;
  // The way up: name the next plan so the button says what it does. Unlimited has nowhere to go but the billing page.
  const index = planOptions.findIndex((option) => option.id === planId);
  const next = index >= 0 ? planOptions[index + 1] : undefined;
  return (
    <div className="pf-planbar">
      <div>
        <div className="lbl">Your plan</div>
        <div className="val">{planName}</div>
      </div>
      <div className="pf-seg" role="list" aria-label="Plans">
        {planOptions.map((option) => (
          <span key={option.id} role="listitem" className={option.id === planId ? "on" : undefined} aria-current={option.id === planId ? "true" : undefined}>
            {option.name}
          </span>
        ))}
      </div>
      <div className="pf-pills">
        {pills.map((pill) => (
          <span key={pill} className="pf-pill">{pill}</span>
        ))}
      </div>
      <span className="push">
        {limit !== null ? (
          <span className="pf-usage">
            <b>{used}</b> of {limit} metered orders · {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left
          </span>
        ) : null}
        {ratio >= 1 ? (
          <span className="pf-badge pf-b-crit">{promptUpgrade ? "At the limit · upgrade to keep printing" : "At the limit · paused until the period resets"}</span>
        ) : ratio >= 0.9 ? (
          <span className="pf-badge pf-b-warn">{promptUpgrade ? "90% used · consider upgrading" : "90% used"}</span>
        ) : null}
        <Btn variant={next ? "primary" : "secondary"} href="/app/billing">{next ? `Upgrade to ${next.name}` : "Change plan"}</Btn>
      </span>
    </div>
  );
}
