import type { GraphData, GraphNode } from "../../types/index.ts";
import { KnowledgeNodesTable } from "./KnowledgeNodesTable.tsx";

export type ProcessedGraphNode = GraphNode & { degree: number };

interface KnowledgeNodesTabProps {
  graphData: GraphData | null;
  processedNodes: ProcessedGraphNode[];
  paginatedNodes: ProcessedGraphNode[];
  nodesTotalPages: number;
  nodesPage: number;
  setNodesPage: (page: number | ((prev: number) => number)) => void;
  nodesType: string;
  setNodesType: (type: string) => void;
  tempNodesSearch: string;
  setTempNodesSearch: (search: string) => void;
  setNodesSearch: (search: string) => void;
  selectedRelationNode: string | null;
  setSelectedRelationNode: (nodeId: string | null) => void;
}

export function KnowledgeNodesTab({
  graphData,
  processedNodes,
  paginatedNodes,
  nodesTotalPages,
  nodesPage,
  setNodesPage,
  nodesType,
  setNodesType,
  tempNodesSearch,
  setTempNodesSearch,
  setNodesSearch,
  selectedRelationNode,
  setSelectedRelationNode,
}: KnowledgeNodesTabProps) {
  return (
    <div
      className="animate-zoom"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
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
            <h2>Danh sách nút trong đồ thị ({processedNodes.length} nút)</h2>
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
                  placeholder="Tìm tên nút, ID..."
                  value={tempNodesSearch}
                  onChange={(e) => setTempNodesSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setNodesSearch(tempNodesSearch);
                      setNodesPage(1);
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
                value={nodesType}
                onChange={(e) => {
                  setNodesType(e.target.value);
                  setNodesPage(1);
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
                <option value="all">Tất cả loại nút</option>
                <option value="Part">Part (Phần)</option>
                <option value="Chapter">Chapter (Chương)</option>
                <option value="Section">Section (Mục)</option>
                <option value="Subsection">Subsection (Tiểu mục)</option>
                <option value="Article">Article (Điều)</option>
                <option value="Clause">Clause (Khoản)</option>
                <option value="ClausePoint">ClausePoint (Điểm)</option>
              </select>
              <button
                className="btn-primary"
                style={{ padding: "6px 12px" }}
                onClick={() => {
                  setNodesSearch(tempNodesSearch);
                  setNodesPage(1);
                }}
              >
                Lọc
              </button>
            </div>
          </div>
          <div className="card-body">
            <KnowledgeNodesTable
              graphData={graphData}
              paginatedNodes={paginatedNodes}
              processedNodesCount={processedNodes.length}
              selectedRelationNode={selectedRelationNode}
              setSelectedRelationNode={setSelectedRelationNode}
              nodesPage={nodesPage}
              nodesTotalPages={nodesTotalPages}
              setNodesPage={setNodesPage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
