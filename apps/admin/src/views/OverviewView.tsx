import type { AdminStats } from "../types/index.ts";

interface OverviewViewProps {
  stats: AdminStats | null;
  collapsedSections: Record<string, boolean>;
  toggleSection: (section: string) => void;
}

export function OverviewView({
  stats,
  collapsedSections,
  toggleSection,
}: OverviewViewProps) {
  return (
    <div className="view-section" key="overview">
      <div className="welcome-banner">
        <h1>Chào mừng trở lại, Admin!</h1>
        <p>Hệ thống GraphRAG đang hoạt động ổn định với hiệu suất tối ưu.</p>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon purple">
            <i className="fas fa-file-contract"></i>
          </div>
          <div className="stat-info">
            <h3>Tổng số Điều luật</h3>
            <div className="value">{stats?.graph?.Article || 0}</div>
            <div className="trend up">
              <i className="fas fa-arrow-up"></i> 12% tháng này
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">
            <i className="fas fa-nodes-circle-nodes"></i>
          </div>
          <div className="stat-info">
            <h3>Nút trong Đồ thị</h3>
            <div className="value">{stats?.graph?.total_nodes || 0}</div>
            <div className="trend up">
              <i className="fas fa-arrow-up"></i> 8% tháng này
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <i className="fas fa-link"></i>
          </div>
          <div className="stat-info">
            <h3>Quan hệ tham chiếu</h3>
            <div className="value">{stats?.graph?.total_edges || 0}</div>
            <div className="trend up">
              <i className="fas fa-arrow-up"></i> 5% tháng này
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">
            <i className="fas fa-bolt"></i>
          </div>
          <div className="stat-info">
            <h3>Thời gian phản hồi TB</h3>
            <div className="value">1.2s</div>
            <div className="trend down">
              <i className="fas fa-arrow-down"></i> 3% hôm nay
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "24px" }}>
        <div
          className={`card-header collapsible ${collapsedSections["nodes"] ? "collapsed" : ""}`}
          onClick={() => toggleSection("nodes")}
        >
          <h2>Cấu trúc Knowledge Graph</h2>
          <i className="fas fa-chevron-up toggle-icon"></i>
        </div>
        {!collapsedSections["nodes"] && (
          <div className="card-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phân loại</th>
                  <th>Loại đối tượng</th>
                  <th>Số lượng</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {stats?.graph &&
                  Object.entries(stats.graph)
                    .filter(
                      ([k]) => !["total_nodes", "total_edges"].includes(k),
                    )
                    .map(([type, count]) => {
                      const isEdge = type.startsWith("edge:");
                      const cleanType = isEdge
                        ? type.replace("edge:", "")
                        : type;
                      return (
                        <tr key={type}>
                          <td>
                            <span
                              className={`type-tag ${isEdge ? "edge" : "node"}`}
                            >
                              {isEdge ? "Edge" : "Node"}
                            </span>
                          </td>
                          <td style={{ fontWeight: 500 }}>{cleanType}</td>
                          <td>{String(count)}</td>
                          <td>
                            <span className="status-badge active">Active</span>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
