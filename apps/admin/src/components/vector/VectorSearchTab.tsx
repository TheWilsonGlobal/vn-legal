import type { VectorResult } from "../../types/index.ts";

interface VectorSearchTabProps {
  vectorQuery: string;
  setVectorQuery: (q: string) => void;
  handleVectorSearch: () => Promise<void>;
  vectorLoading: boolean;
  vectorResults: VectorResult[];
  setPreviewArticle: (article: VectorResult | null) => void;
}

export function VectorSearchTab({
  vectorQuery,
  setVectorQuery,
  handleVectorSearch,
  vectorLoading,
  vectorResults,
  setPreviewArticle,
}: VectorSearchTabProps) {
  return (
    <div className="card animate-zoom" style={{ marginTop: "20px" }}>
      <div className="card-header">
        <h2>Thử nghiệm tìm kiếm Vector</h2>
      </div>
      <div className="card-body">
        <div className="search-box">
          <input
            type="text"
            placeholder="Nhập từ khóa tìm kiếm vector..."
            value={vectorQuery}
            onChange={(e) => setVectorQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVectorSearch()}
          />
          <button
            className="btn-primary"
            onClick={handleVectorSearch}
            disabled={vectorLoading}
          >
            {vectorLoading ? (
              <i className="fas fa-spinner fa-spin"></i>
            ) : (
              "Tìm kiếm"
            )}
          </button>
        </div>
        <div className="results-container" id="vector-results-panel">
          {vectorResults.length > 0 ? (
            <div className="vector-results-list">
              {vectorResults.map((res, i) => {
                const score = 1 - res._distance;
                const scorePct = Math.round(score * 100);
                const scoreColorClass =
                  score > 0.4
                    ? "score-high"
                    : score > 0.25
                      ? "score-mid"
                      : "score-low";
                const scoreBgClass =
                  score > 0.4
                    ? "score-high-bg"
                    : score > 0.25
                      ? "score-mid-bg"
                      : "score-low-bg";

                return (
                  <div
                    key={i}
                    className="vector-result-card animate-in"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <div className="result-card-header">
                      <div className="result-id-badge">{res.article_id}</div>
                      <div className="result-score-container">
                        <div className={`score-value ${scoreColorClass}`}>
                          {scorePct}% Match
                        </div>
                        <div className="score-bar-container">
                          <div
                            className={`score-bar-fill ${scoreBgClass}`}
                            style={{ width: `${scorePct}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                    <div
                      className="result-title"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--accent-blue)",
                        marginBottom: "8px",
                      }}
                    >
                      {res.type === "clause"
                        ? `${res.article_title || "N/A"} - Khoản ${res.clause_number || "?"}`
                        : res.title || `Điều ${res.article_number || "?"}`}
                    </div>
                    <div className="result-content">{res.content}</div>
                    <div className="result-actions">
                      <button
                        className="btn-ghost"
                        onClick={() => setPreviewArticle(res)}
                      >
                        <i className="fas fa-external-link-alt"></i> View
                        Article
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="placeholder-text">
              {vectorLoading
                ? "Đang tìm kiếm..."
                : "Kết quả sẽ hiển thị tại đây..."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
