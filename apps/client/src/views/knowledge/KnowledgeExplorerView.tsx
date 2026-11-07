import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ConsultCommunityReport } from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/views.css";
import { useApiResource } from "../sessions/useApiResource";
import { ArticleModal } from "./ArticleModal";
import { GraphCanvas } from "./GraphCanvas";
import { CY_STYLE, buildElements } from "./graph-builder";
import { ReportModal } from "./ReportModal";
import { ResultsAccordion } from "./ResultsAccordion";
import {
  type ArticleItem,
  type CyInstance,
  getCytoscape,
  loadExplorerConfig,
} from "./types";

export default function KnowledgeExplorerView(props: ViewProps) {
  const { active, lastContext, navigate } = props;
  const config = useApiResource(active, "explorer-config", loadExplorerConfig);

  const [expanded, setExpanded] = useState<string[]>(["semantic", "graph"]);
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<ArticleItem | null>(
    null,
  );
  const [selectedReport, setSelectedReport] =
    useState<ConsultCommunityReport | null>(null);
  const cyRef = useRef<CyInstance | null>(null);
  const cyContainerRef = useRef<HTMLDivElement>(null);

  const mode =
    config.resource.status === "ready" ? config.resource.data.mode : null;
  const cytoscapeMissing = mode === "query" && getCytoscape() === null;
  const showQueryGraph = mode === "query" && lastContext !== null;
  const graphBuild = useMemo(
    () => (showQueryGraph && lastContext ? buildElements(lastContext) : null),
    [showQueryGraph, lastContext],
  );

  // Cytoscape lives only while this view is visible: a hidden (display:none)
  // container has size 0 and would lay the graph out in a point.
  useEffect(() => {
    if (!active || !graphBuild) return;
    const factory = getCytoscape();
    if (!factory || !cyContainerRef.current) return;
    const cy = factory({
      container: cyContainerRef.current,
      elements: { nodes: graphBuild.nodes, edges: graphBuild.edges },
      style: CY_STYLE,
      layout: {
        name: "fcose",
        randomize: true,
        animate: true,
        fit: true,
        padding: 30,
      },
    });
    cyRef.current = cy;
    cy.on("zoom", () => setZoom(cy.zoom()));
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [active, graphBuild]);

  const toggleSection = (name: string) =>
    setExpanded((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setZoom(val);
    cyRef.current?.zoom(val);
    cyRef.current?.center();
  };

  return (
    <div className="vw-knowledge">
      <div className="top-section">
        <ResultsAccordion
          lastContext={lastContext}
          expanded={expanded}
          toggleSection={toggleSection}
          onSelectArticle={setSelectedArticle}
          onSelectReport={setSelectedReport}
          onNavigateAssistant={() => navigate("assistant")}
        />

        <div className="graph-main-panel glass-card">
          <div className="panel-header">
            <h3>
              <i className="fas fa-network-wired"></i> Trực quan hóa Đồ thị
            </h3>
          </div>
          <div className="graph-content-wrapper">
            <GraphCanvas
              config={config}
              cytoscapeMissing={cytoscapeMissing}
              lastContext={lastContext}
              graphBuild={graphBuild}
              zoom={zoom}
              panelOpen={panelOpen}
              setPanelOpen={setPanelOpen}
              handleZoomChange={handleZoomChange}
              cyRef={cyRef}
              cyContainerRef={cyContainerRef}
            />
          </div>
        </div>
      </div>

      {selectedReport && (
        <ReportModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
        />
      )}
      {selectedArticle && (
        <ArticleModal
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  );
}
