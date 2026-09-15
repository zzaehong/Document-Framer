export const GENERATION_CONFIG = {
  responseMimeType: 'application/json', candidateCount: 1, temperature: 1,
  maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'minimal' },
} as const;
export interface EvaluationTrace {
  runId: string;
  purpose: 'connection' | 'classification';
  documentPath: string | null;
  sourceHash: string;
  hashEncoding: 'sha256-utf8-raw-v1';
  promptVersion: string;
  taxonomyVersion: string;
  segmenterVersion: string;
  responseSchemaVersion: 'classification-schema-v1';
  generationConfig: typeof GENERATION_CONFIG;
}
export async function sourceHash(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
