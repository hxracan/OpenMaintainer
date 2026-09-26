import type { Condition, Rule } from '@openmaintainer/config';
import type { DomainEvent } from '@openmaintainer/core';
import picomatch from 'picomatch';
export interface ConditionResult {
  condition: Condition;
  matched: boolean;
  reason: string;
}
export function evaluateCondition(condition: Condition, event: DomainEvent): ConditionResult {
  const actual = event.facts[condition.field],
    expected = condition.value;
  let matched = false;
  if (actual === undefined)
    return { condition, matched: false, reason: `Fact ${condition.field} is unavailable` };
  switch (condition.operator) {
    case 'eq':
      matched = actual === expected;
      break;
    case 'neq':
      matched = actual !== expected;
      break;
    case 'gt':
      matched = typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      break;
    case 'gte':
      matched = typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      break;
    case 'lt':
      matched = typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      break;
    case 'lte':
      matched = typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      break;
    case 'contains':
      matched = Array.isArray(actual)
        ? typeof expected === 'string' && actual.includes(expected)
        : typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
      break;
    case 'in':
      matched = Array.isArray(expected) && typeof actual === 'string' && expected.includes(actual);
      break;
    case 'matches':
      if (typeof expected === 'string') {
        const matcher = picomatch(expected, { maxLength: 500, nobrace: true, noext: true });
        matched = Array.isArray(actual)
          ? actual.some((x) => matcher(x))
          : typeof actual === 'string' && matcher(actual);
      }
      break;
  }
  return {
    condition,
    matched,
    reason: `${condition.field} ${condition.operator} ${JSON.stringify(expected)} → ${matched}`,
  };
}
export function evaluateRule(rule: Rule, event: DomainEvent) {
  const conditions = rule.if.map((c) => evaluateCondition(c, event));
  return {
    ruleId: rule.id,
    matched: rule.enabled && rule.when === event.trigger && conditions.every((c) => c.matched),
    conditions,
  };
}
