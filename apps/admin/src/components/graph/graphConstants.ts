export const TYPE_COLORS: Record<string, string> = {
  Part: "#8b5cf6", // Purple
  Chapter: "#3b82f6", // Blue
  Section: "#10b981", // Green
  Subsection: "#f59e0b", // Orange
  Article: "#ec4899", // Pink
  Clause: "#06b6d4", // Cyan
  ClausePoint: "#84cc16", // Lime
};

export const HIERARCHY_TYPES = new Set([
  "HAS_SECTION",
  "HAS_CHAPTER",
  "HAS_SUBSECTION",
  "HAS_CLAUSE",
  "HAS_POINT",
  "HAS_PART",
]);

export const STRUCTURAL_LABELS = new Set([
  "Part",
  "Chapter",
  "Section",
  "Book",
]);

export const DEFAULT_VISIBLE_TYPES: string[] = [
  "Part",
  "Chapter",
  "Section",
  "Subsection",
  "Article",
  "Clause",
  "ClausePoint",
];

export const DEFAULT_VISIBLE_EDGE_TYPES: string[] = [
  "HAS_CHAPTER",
  "HAS_SECTION",
  "HAS_SUBSECTION",
  "BELONGS_TO_SUBSECTION",
  "BELONGS_TO_SECTION",
  "BELONGS_TO_CHAPTER",
  "HAS_CLAUSE",
  "HAS_POINT",
];
