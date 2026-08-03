export type WatchedCopyRun = { id: string; action: string };
export type CompletedCopyRun = WatchedCopyRun & {
  status: 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  error?: string;
};

export type CopyRunCompletion =
  | { type: 'IGNORE' }
  | { type: 'WAIT' }
  | { type: 'ERROR'; message: string }
  | { type: 'SYNC_GENERATED_DRAFT' }
  | { type: 'COMPLETE' };

export function copyRunCompletion(watchedRun: WatchedCopyRun | null, run: CompletedCopyRun | null): CopyRunCompletion;
