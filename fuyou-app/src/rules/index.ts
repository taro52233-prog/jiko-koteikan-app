import { rules2026 } from './2026';
import type { RuleSet } from './types';

export const ruleSets: Record<number, RuleSet> = {
  2026: rules2026,
};

export const supportedYears = Object.keys(ruleSets).map(Number).sort();

export function getRules(year: number): RuleSet | undefined {
  return ruleSets[year];
}

export type { RuleSet, Source } from './types';
