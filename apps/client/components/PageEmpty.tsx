import { Icon, type IconName } from "@/components/Icon";

/** A friendly centered empty-state: a tinted icon disc + title + one line of
 *  guidance. Shared across pages (Human gates, Meetings, Feedback, Decisions…). */
export function PageEmpty({
  icon, title, sub, tone = "var(--green)", testid,
}: {
  icon: IconName;
  title: string;
  sub: string;
  tone?: string;
  testid?: string;
}) {
  return (
    <div className="page-empty" data-testid={testid} style={{ margin: "auto" }}>
      <span className="page-empty-ic" style={{ color: tone }}>
        <Icon name={icon} size={26} />
      </span>
      <div className="page-empty-title">{title}</div>
      <div className="page-empty-sub">{sub}</div>
    </div>
  );
}
