import type { Activity } from "../types/index.ts";

interface ActivitiesViewProps {
  activities: Activity[];
  fetchActivities: () => Promise<void>;
  handleOpenActivityJSON: (activity: Activity) => void;
  handleDownloadActivityJSON: (activity: Activity) => void;
}

export function ActivitiesView({
  activities,
  fetchActivities,
  handleOpenActivityJSON,
  handleDownloadActivityJSON,
}: ActivitiesViewProps) {
  return (
    <div className="view-section" key="activities">
      <div className="view-header">
        <h2>Nhật ký hoạt động</h2>
        <button className="btn-primary" onClick={fetchActivities}>
          <i className="fas fa-sync-alt"></i> Tải lại nhật ký
        </button>
      </div>

      <div className="card full-width" style={{ marginTop: "20px" }}>
        <div
          className="card-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2>Danh sách hoạt động gần đây</h2>
          <span className="badge-dim">{activities.length} sự kiện</span>
        </div>
        <div className="card-body">
          <ul className="activity-list">
            {activities.length > 0 ? (
              activities.map((activity) => (
                <li
                  className="activity-item"
                  key={activity.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    <div
                      className={`activity-marker ${activity.type === "query" ? "blue" : activity.type === "error" ? "red" : activity.type === "system" ? "purple" : "green"}`}
                    ></div>
                    <div
                      className="activity-details"
                      style={{ marginLeft: "12px" }}
                    >
                      <p style={{ margin: 0, fontWeight: 500 }}>
                        {activity.message}
                      </p>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-dim)",
                        }}
                      >
                        {new Date(activity.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div
                    className="activity-actions"
                    style={{ display: "flex", gap: "8px" }}
                  >
                    {activity.details && (
                      <>
                        <button
                          className="btn-small"
                          style={{
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "#10b981",
                            border: "1px solid rgba(16, 185, 129, 0.3)",
                          }}
                          title="Xem cấu trúc dữ liệu JSON pipeline trong tab mới"
                          onClick={() => handleOpenActivityJSON(activity)}
                        >
                          <i
                            className="fas fa-external-link-alt"
                            style={{ marginRight: "4px" }}
                          ></i>{" "}
                          Xem JSON
                        </button>
                        <button
                          className="btn-small btn-secondary"
                          title="Tải xuống tệp tin pipeline định dạng JSON"
                          onClick={() => handleDownloadActivityJSON(activity)}
                        >
                          <i
                            className="fas fa-download"
                            style={{ marginRight: "4px" }}
                          ></i>{" "}
                          Tải JSON
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))
            ) : (
              <li className="activity-item">
                <div className="activity-marker gray"></div>
                <div className="activity-details">
                  <p>Chưa có hoạt động nào được ghi nhận.</p>
                </div>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
