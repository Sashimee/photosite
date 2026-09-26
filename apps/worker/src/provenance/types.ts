export interface ProvenanceImageRef {
  portfolioImageId: string;
}

export interface AiDetectionResult {
  vendor: string;
  score: number | null;
  raw: unknown;
}

export interface AiDetectionProvider {
  detect(image: ProvenanceImageRef): Promise<AiDetectionResult>;
}

export interface ReverseSearchMatch {
  url: string;
  domain: string;
  similarity: number;
}

export interface ReverseSearchResult {
  vendor: string;
  matches: ReverseSearchMatch[];
}

export interface ReverseSearchProvider {
  search(image: ProvenanceImageRef): Promise<ReverseSearchResult>;
}

export interface C2paResult {
  c2paValid: boolean | null;
}

export interface C2paReader {
  read(image: ProvenanceImageRef): Promise<C2paResult>;
}
