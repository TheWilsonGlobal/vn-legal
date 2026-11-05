import type { RelationsLeaderboard, Relation } from "../../types/index.ts";
import { KnowledgeRelationsLeaderboard } from "./KnowledgeRelationsLeaderboard.tsx";
import { KnowledgeRelationsTable } from "./KnowledgeRelationsTable.tsx";

interface KnowledgeRelationsTabProps {
  relationsLeaderboard: RelationsLeaderboard;
  setSelectedRelationNode: (nodeId: string | null) => void;
  relationsTotalItems: number;
  tempRelationsSearch: string;
  setTempRelationsSearch: (search: string) => void;
  setRelationsSearch: (search: string) => void;
  relationsType: string;
  setRelationsType: (type: string) => void;
  relationsLoading: boolean;
  relations: Relation[];
  selectedRelationNode: string | null;
  relationsPage: number;
  relationsTotalPages: number;
  setRelationsPage: (page: number | ((prev: number) => number)) => void;
}

export function KnowledgeRelationsTab({
  relationsLeaderboard,
  setSelectedRelationNode,
  relationsTotalItems,
  tempRelationsSearch,
  setTempRelationsSearch,
  setRelationsSearch,
  relationsType,
  setRelationsType,
  relationsLoading,
  relations,
  selectedRelationNode,
  relationsPage,
  relationsTotalPages,
  setRelationsPage,
}: KnowledgeRelationsTabProps) {
  return (
    <div
      className="animate-zoom"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <KnowledgeRelationsLeaderboard
        relationsLeaderboard={relationsLeaderboard}
        setSelectedRelationNode={setSelectedRelationNode}
      />

      <div style={{ width: "100%" }}>
        <div className="card" style={{ width: "100%" }}>
          <div
            className="card-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <h2>Danh sách quan hệ chi tiết ({relationsTotalItems} liên kết)</h2>
            <div
              className="header-actions"
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Tìm ID, tên nút, nội dung..."
                  value={tempRelationsSearch}
                  onChange={(e) => setTempRelationsSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setRelationsSearch(tempRelationsSearch);
                      setRelationsPage(1);
                    }
                  }}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "6px",
                    padding: "6px 12px 6px 30px",
                    color: "#fff",
                    fontSize: "13px",
                  }}
                />
                <i
                  className="fas fa-search"
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: "12px",
                    color: "rgba(255,255,255,0.4)",
                  }}
                ></i>
              </div>
              <select
                value={relationsType}
                onChange={(e) => {
                  setRelationsType(e.target.value);
                  setRelationsPage(1);
                }}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  color: "#fff",
                  fontSize: "13px",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="all">Tất cả liên kết</option>
                <option value="REFERENCES">REFERENCES (Tham chiếu)</option>
                <option value="NEXT_ARTICLE">NEXT_ARTICLE (Tuần tự)</option>
                <option value="BELONGS_TO_CHAPTER">BELONGS_TO_CHAPTER</option>
                <option value="BELONGS_TO_SECTION">BELONGS_TO_SECTION</option>
                <option value="BELONGS_TO_SUBSECTION">
                  BELONGS_TO_SUBSECTION
                </option>
                <option value="HAS_CHAPTER">HAS_CHAPTER</option>
                <option value="HAS_SECTION">HAS_SECTION</option>
                <option value="HAS_SUBSECTION">HAS_SUBSECTION</option>
                <option value="HAS_CLAUSE">HAS_CLAUSE</option>
                <option value="HAS_POINT">HAS_POINT</option>
              </select>
              <button
                className="btn-primary"
                style={{ padding: "6px 12px" }}
                onClick={() => {
                  setRelationsSearch(tempRelationsSearch);
                  setRelationsPage(1);
                }}
              >
                Lọc
              </button>
            </div>
          </div>
          <div className="card-body">
            <KnowledgeRelationsTable
              relationsLoading={relationsLoading}
              relations={relations}
              selectedRelationNode={selectedRelationNode}
              setSelectedRelationNode={setSelectedRelationNode}
              relationsPage={relationsPage}
              relationsTotalPages={relationsTotalPages}
              relationsTotalItems={relationsTotalItems}
              setRelationsPage={setRelationsPage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
