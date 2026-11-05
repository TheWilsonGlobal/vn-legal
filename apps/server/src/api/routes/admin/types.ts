import type { GraphClient } from "../../../graph/client";
import type { IVectorStore } from "../../../embeddings/vector-store-factory";
import type { LegalConsultationAgent } from "../../../agent/setup";

export interface AdminRoutesOptions {
  graph: GraphClient;
  vectorStore: IVectorStore;
  agent?: LegalConsultationAgent;
}
