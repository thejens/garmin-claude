import type { Sample } from '../types.js';

export type SampleEmitter = (sample: Omit<Sample, 'cursor'>) => void;

export interface MetricSource {
  start(emit: SampleEmitter): Promise<void>;
  stop(): Promise<void>;
}
