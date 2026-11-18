// ============================================================================
// Legal structure types shared by the server and the client.
// ============================================================================

import type { LEGAL_CONCEPT_CATEGORIES } from "../constants/src";

export type LegalConceptCategory = (typeof LEGAL_CONCEPT_CATEGORIES)[number];

export interface ArticleMetadata {
  part: string;
  chapter: string;
  section: string;
  subsection: string;
  source?: string;
}

export interface ClausePoint {
  id: string;
  point_letter: string;
  text: string;
  clause_id: string;
  [key: string]: unknown;
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
