import type { ObservationGraph } from "../../types/agent";

const COL_GAP = 230;
const ROW_GAP = 66;
const NODE_W = 196;
const NODE_H = 46;
const PAD_X = 16;
const PAD_Y = 22;

type Node = ObservationGraph["nodes"][number];

interface Placed extends Node {
  x: number;
  y: number;
}

/**
 * Column = reference hops from the nearest seed (`depth`), so every edge runs
 * from a left column to a right one and no curve crosses a node. Inside a
 * column, nodes follow the average row of their parents, which keeps the
 * curves short. Ties fall back to article number, so the layout is stable.
 */
/**
 * Column from the edges alone, for records written before `depth` existed:
 * a node with no incoming edge is column 0, any other node is one more than
 * its deepest parent. The pass count is capped, so a cycle cannot loop forever.
 */
function depthFromEdges(graph: ObservationGraph): Map<string, number> {
  const parents = new Map<string, string[]>();
  for (const e of graph.edges) {
    parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  }
  const depth = new Map<string, number>();
  for (let pass = 0; pass <= graph.nodes.length; pass++) {
    let changed = false;
    for (const n of graph.nodes) {
      const ps = parents.get(n.id) ?? [];
      // Seeds stay in column 0. A linked article with no parent in view was
      // reached from a keyword seed that is not drawn, so it goes in column 1.
      const d =
        n.kind === "vector"
          ? 0
          : 1 + Math.max(0, ...ps.map((p) => depth.get(p) ?? 0));
      if (depth.get(n.id) !== d) {
        depth.set(n.id, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

function layout(graph: ObservationGraph) {
  // Use the server's depth when every node has it; otherwise derive it from the edges.
  const fromEdges = depthFromEdges(graph);
  const hasDepth = graph.nodes.every((n) => typeof n.depth === "number");
  const nodes: Node[] = graph.nodes.map((n) => ({
    ...n,
    depth: hasDepth ? (n.depth as number) : (fromEdges.get(n.id) ?? 0),
  }));
  const columns = new Map<number, Node[]>();
  for (const n of nodes) {
    columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
  }
  const depths = [...columns.keys()].sort((a, b) => a - b);

  const row = new Map<string, number>();
  let maxRows = 1;
  for (const d of depths) {
    const nodes = columns.get(d) ?? [];
    const parentsOf = (id: string) =>
      graph.edges.filter((e) => e.to === id).map((e) => row.get(e.from));
    const barycentre = (n: Node) => {
      const ys = parentsOf(n.id).filter((y): y is number => y !== undefined);
      return ys.length > 0 ? ys.reduce((s, y) => s + y, 0) / ys.length : n.number;
    };
    const sorted = [...nodes].sort(
      (a, b) => barycentre(a) - barycentre(b) || a.number - b.number,
    );
    maxRows = Math.max(maxRows, sorted.length);
    sorted.forEach((n, i) => row.set(n.id, i));
  }

  const placed = new Map<string, Placed>();
  for (const n of nodes) {
    placed.set(n.id, {
      ...n,
      x: PAD_X + n.depth * COL_GAP,
      y: PAD_Y + (row.get(n.id) ?? 0) * ROW_GAP,
    });
  }
  const maxDepth = depths.length > 0 ? depths[depths.length - 1] : 0;
  return {
    nodes: [...placed.values()],
    placed,
    width: PAD_X * 2 + maxDepth * COL_GAP + NODE_W,
    height: PAD_Y * 2 + (maxRows - 1) * ROW_GAP + NODE_H,
  };
}

function shorten(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface Props {
  graph: ObservationGraph;
}

export default function ObservationGraphView({ graph }: Props) {
  if (graph.nodes.length === 0) {
    return <p className="muted obs-graph-empty">Không có điều luật để vẽ.</p>;
  }
  const { nodes, placed, width, height } = layout(graph);
  const edges = graph.edges.filter(
    (e) => placed.has(e.from) && placed.has(e.to),
  );

  return (
    <figure className="obs-graph" aria-label="Đồ thị điều luật liên quan">
      <div className="obs-graph-scroll">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
        >
          <defs>
            <marker
              id="obs-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="obs-arrow" />
            </marker>
          </defs>
          {edges.map((e) => {
            const a = placed.get(e.from)!;
            const b = placed.get(e.to)!;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                className="obs-edge"
                markerEnd="url(#obs-arrow)"
              />
            );
          })}
          {nodes.map((n) => (
            <g key={n.id} className={`obs-node obs-node-${n.kind}`}>
              <title>{`Điều ${n.number}: ${n.title}`}</title>
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={10} />
              <text x={n.x + 12} y={n.y + 19} className="obs-node-num">
                {`Điều ${n.number}`}
              </text>
              <text x={n.x + 12} y={n.y + 36} className="obs-node-title">
                {shorten(n.title.replace(/^Điều\s+\d+\.?\s*/, ""))}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="obs-legend muted">
        <span className="obs-dot obs-dot-vector" aria-hidden="true" />
        khớp ngữ nghĩa
        <span className="obs-dot obs-dot-path" aria-hidden="true" />
        qua tham chiếu
      </figcaption>
    </figure>
  );
}
