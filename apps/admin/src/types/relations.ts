export interface Relation {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
  targetId: string;
  targetLabel: string;
  targetType: string;
  type: string;
  context: string | null;
  reference_text: string | null;
}

export interface RelationLeaderboardItem {
  id: string;
  title: string;
  count: number;
}

export interface RelationsLeaderboard {
  topReferenced: RelationLeaderboardItem[];
  topReferring: RelationLeaderboardItem[];
}
