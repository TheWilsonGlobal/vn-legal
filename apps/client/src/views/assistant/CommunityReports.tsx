import type { ObservationReport } from "../../types/agent";

interface Props {
  reports: ObservationReport[];
}

/** Community reports that matched the query, as cards (the "Global Synthesis" view). */
export default function CommunityReports({ reports }: Props) {
  return (
    <ul className="community-reports" aria-label="Báo cáo tổng quan cộng đồng">
      {reports.map((r, i) => (
        <li key={`${r.title}-${i}`} className="community-report">
          <div className="community-report-head">
            <span className="community-report-title">{r.title || "Báo cáo"}</span>
            {typeof r.rating === "number" && (
              <span className="community-report-rating">★ {r.rating}</span>
            )}
          </div>
          {r.summary && <p className="community-report-summary">{r.summary}</p>}
        </li>
      ))}
    </ul>
  );
}
