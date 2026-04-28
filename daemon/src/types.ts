export interface Sample {
  cursor: number;
  t: number;                  // unix ms
  tokens_per_sec: number;
  tools_per_min: number;
  cum_tokens: number;
  lines_added: number;
  lines_removed: number;
  current_file_hash: number;  // 32-bit hash of file path
  model_id: number;           // see docs/metrics.md
  watts_estimate: number;     // tokens_per_sec * J/token for this model (server-side estimate)
  lap?: 'new';                // present on first sample of a new user turn
  session_id: string;
}

export interface BearerKey {
  key: string;
  label: string;
  created: string;  // ISO 8601
}

export interface Config {
  version: number;
  bearer_keys: BearerKey[];
  tunnel: {
    mode: 'quick' | 'named';
    name: string | null;
    last_known_url: string | null;
    url_observed_at: string | null;
  };
  metrics: {
    source: 'jsonl-tail' | 'mock';
    // Override for non-standard Claude Code installations.
    // Comma-separated list; also readable from CLAUDE_PROJECTS_DIRS env var.
    // Auto-detected if null. Each entry is a projects/ root, not a single file.
    jsonl_paths: string[] | null;
  };
  server: {
    port: number;
    bind: string;
  };
}
