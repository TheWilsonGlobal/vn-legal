import type {
  RelationsLeaderboard,
  RelationLeaderboardItem,
} from "../../types/index.ts";

interface KnowledgeRelationsLeaderboardProps {
  relationsLeaderboard: RelationsLeaderboard;
  setSelectedRelationNode: (nodeId: string | null) => void;
}

export function KnowledgeRelationsLeaderboard({
  relationsLeaderboard,
  setSelectedRelationNode,
}: KnowledgeRelationsLeaderboardProps) {
  return (
    <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
      <div className="card" style={{ flex: 1, minWidth: "300px" }}>
        <div className="card-header">
          <h2>
            <i
              className="fas fa-arrow-down"
              style={{ color: "var(--accent-blue)" }}
            ></i>{" "}
            Top Điều luật được dẫn chiếu nhiều nhất
          </h2>
        </div>
        <div className="card-body" style={{ padding: "16px 20px" }}>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {relationsLeaderboard?.topReferenced?.map(
              (item: RelationLeaderboardItem, idx: number) => (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <span
                    onClick={() => setSelectedRelationNode(item.id)}
                    style={{
                      color: "#3b82f6",
                      cursor: "pointer",
                      fontWeight: 500,
                      fontSize: "14px",
                    }}
                    title="Click để trực quan hóa đồ thị liên kết"
                  >
                    {idx + 1}. {item.title}
                  </span>
                  <span
                    className="badge-dim"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    {item.count} lượt
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: "300px" }}>
        <div className="card-header">
          <h2>
            <i
              className="fas fa-arrow-up"
              style={{ color: "var(--accent-purple)" }}
            ></i>{" "}
            Top Điều luật dẫn chiếu đi nhiều nhất
          </h2>
        </div>
        <div className="card-body" style={{ padding: "16px 20px" }}>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {relationsLeaderboard?.topReferring?.map(
              (item: RelationLeaderboardItem, idx: number) => (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <span
                    onClick={() => setSelectedRelationNode(item.id)}
                    style={{
                      color: "#a78bfa",
                      cursor: "pointer",
                      fontWeight: 500,
                      fontSize: "14px",
                    }}
                    title="Click để trực quan hóa đồ thị liên kết"
                  >
                    {idx + 1}. {item.title}
                  </span>
                  <span
                    className="badge-dim"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    {item.count} lượt
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
