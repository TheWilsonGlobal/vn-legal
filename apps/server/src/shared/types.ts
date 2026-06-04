// ============================================================================
// Legal Domain Types
// ============================================================================

export interface ArticleNode {
  id: string;
  article_number: number;
  title: string;
  content: string;
  metadata: ArticleMetadata;
  keywords: string[];
  hierarchical_path: string;
  clause_count: number;
  clauses: ArticleClause[];
  [key: string]: unknown;
}

export interface ArticleMetadata {
  part: string;
  chapter: string;
  section: string;
  subsection: string;
  source?: string;
}

export interface ArticleClause {
  id: string;
  clause_number: number;
  text: string;
  article_id: string;
  points: ClausePoint[];
  point_count: number;
  [key: string]: unknown;
}

export interface ClausePoint {
  id: string;
  point_letter: string;
  text: string;
  clause_id: string;
  [key: string]: unknown;
}

// ----------------------------------------------------------------------------
// Hierarchical Structural Types
// ----------------------------------------------------------------------------

export interface PartNode {
  id: string;
  name: string;
  name_short: string;
  part_number: number;
  chapter_count: number;
  article_count: number;
}

export interface ChapterNode {
  id: string;
  name: string;
  name_short: string;
  chapter_roman: string;
  part_id: string;
  article_count: number;
  section_count: number;
  summary: string;
}

export interface SectionNode {
  id: string;
  name: string;
  name_short: string;
  section_number: number;
  chapter_id: string;
  article_count: number;
  subsection_count: number;
}

export interface SubsectionNode {
  id: string;
  name: string;
  name_short: string;
  subsection_number: number;
  section_id: string;
  article_count: number;
}

export interface LegalConceptNode {
  id: string;
  name: string;
  name_variants: string[];
  definition: string;
  category:
    | "person"
    | "property"
    | "contract"
    | "inheritance"
    | "family"
    | "tort"
    | "other";
  source_articles: string[];
  source_clauses: string[];
  related_concepts: string[];
}

export interface ClauseNode {
  id: string;
  clause_number: number;
  text: string;
  article_id: string;
  point_count: number;
}

export interface ClausePointNode {
  id: string;
  point_letter: string;
  text: string;
  clause_id: string;
}

// ----------------------------------------------------------------------------
// Relationship Types
// ----------------------------------------------------------------------------

export interface PartToChapterEdge {
  from: string;
  to: string;
  order: number;
}

export interface ChapterToSectionEdge {
  from: string;
  to: string;
  order: number;
}

export interface SectionToSubsectionEdge {
  from: string;
  to: string;
  order: number;
}

export interface ArticleBelongsToEdge {
  from: string;
  to: string;
  level: "SUBSECTION" | "SECTION" | "CHAPTER";
}

export interface ArticleHasClauseEdge {
  from: string;
  to: string;
  order: number;
}

export interface ClauseHasPointEdge {
  from: string;
  to: string;
  order: number;
}

export interface ReferencesEdge {
  from: string;
  to: string;
  reference_type: string;
  context: string;
  reference_text: string;
  strength: number;
}

export interface ReferencedByEdge {
  from: string;
  to: string;
}

export interface NextArticleEdge {
  from: string;
  to: string;
  same_context: boolean;
}

// ----------------------------------------------------------------------------
// Embedding Types
// ----------------------------------------------------------------------------

export interface ArticleEmbedding {
  vector: number[];
  article_id: string;
  article_number: number;
  title: string;
  part: string;
  chapter: string;
  section: string;
  subsection: string;
  keywords: string;
  content: string;
  [key: string]: unknown;
}

export interface ClauseEmbedding {
  vector: number[];
  clause_id: string;
  article_id: string;
  clause_number: number;
  text: string;
  article_title: string;
  part: string;
  chapter: string;
  [key: string]: unknown;
}

export interface CommunityEmbedding {
  vector: number[];
  id: string;
  level: number;
  title: string;
  summary: string;
  findings: string;
  rating: number;
  parentId?: string;
  entityIds: string[];
}

export interface VectorResult extends Record<string, unknown> {
  id?: string;
  article_id?: string;
  clause_id?: string;
  title?: string;
  text?: string;
  article_number?: number;
  clause_number?: number;
  article_title?: string;
  content?: string;
  part?: string;
  chapter?: string;
  section?: string;
  subsection?: string;
  keywords?: string;
  _distance?: number;
}

// ----------------------------------------------------------------------------
// Analysis and Community Types
// ----------------------------------------------------------------------------

export interface CommunityReport {
  id: string;
  level: number;
  title: string;
  summary: string;
  findings: string[];
  rating: number;
  parent_id?: string;
  community_id?: string;
  principles?: string;
  article_count?: number;
  [key: string]: unknown;
}

export interface CommunityRelevance {
  community: CommunityReport;
  relevance: number;
}

export interface CommunityContext {
  part: PartNode;
  chapter: ChapterNode;
  section: SectionNode | null;
  subsection: SubsectionNode | null;
  article_count: number;
  principles: string;
  hierarchical_context: string;
}

export interface SeedArticle {
  article_id: string;
  score: number;
  article: ArticleNode;
  matched_entity_id?: string;
}

export interface PathNode {
  article: ArticleNode;
  depth: number;
  path: string[];
  relationship: string;
  matched_entity_id?: string;
}

export interface ConsultationRequest {
  query: string;
  filters?: {
    part_id?: string;
    chapter_id?: string;
    section_id?: string;
    subsection_id?: string;
  };
}

export interface ConsultationResponse {
  query: string;
  response: string;
  context: LegalContextBundle;
  timestamp: Date;
}

export interface HealthResponse {
  status: string;
  databases: {
    graph: boolean;
    vector: boolean;
  };
  timestamp: Date;
}

// ----------------------------------------------------------------------------
// High-level Context Types
// ----------------------------------------------------------------------------

export interface LegalContextBundle {
  query: string;
  seed_articles: SeedArticle[];
  path_context: PathNode[];
  community_context: CommunityContext;
  community_reports: CommunityReport[];
  relevant_concepts: LegalConceptNode[];
  hierarchical_filter: Record<string, string>;
  timestamp: Date;
  // Legacy compatibility fields
  articles?: ArticleNode[];
  concepts?: LegalConceptNode[];
}

export interface ParsedLegalData {
  parts: Map<string, PartNode>;
  chapters: Map<string, ChapterNode>;
  sections: Map<string, SectionNode>;
  subsections: Map<string, SubsectionNode>;
  articles: Map<string, ArticleNode>;
  partToChapters: Map<string, string[]>;
  chapterToSections: Map<string, string[]>;
  sectionToSubsections: Map<string, string[]>;
  articleToParent: Map<string, { type: string; id: string }>;
  communityReports?: CommunityReport[];
  edges?: any[];
}

// ----------------------------------------------------------------------------
// Raw JSON Types
// ----------------------------------------------------------------------------

export interface RawArticleJson {
  article_number: number;
  title: string;
  content: string;
  metadata: {
    part: string;
    chapter: string;
    section: string;
    subsection: string;
  };
  clauses: Array<{
    clause_number: number;
    text: string;
    points: Array<{
      point_letter: string;
      text: string;
    }>;
  }>;
  keywords: string[];
  references: Array<{
    target_article_number: number;
    reference_type: string;
    context: string;
    reference_text: string;
  }>;
}
