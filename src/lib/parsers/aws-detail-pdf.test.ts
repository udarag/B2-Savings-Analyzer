import { describe, it, expect } from 'vitest';
import { classifyGrandTotalReconciliation } from './aws-detail-pdf';

describe('classifyGrandTotalReconciliation', () => {
  it('returns neither signal nor warning when there is no grand total to reconcile against', () => {
    expect(classifyGrandTotalReconciliation(100, 0)).toEqual({});
  });

  it('treats under-capture as a neutral commercial signal, never a warning', () => {
    const r = classifyGrandTotalReconciliation(300, 1000);
    expect(r.warning).toBeUndefined();
    expect(r.commercialSignal).toMatch(/30\.0% of the bill/);
    expect(r.commercialSignal).toMatch(/out-of-scope/);
  });

  it('treats over-capture as a blocking warning containing "grand total"', () => {
    const r = classifyGrandTotalReconciliation(1200, 1000);
    expect(r.commercialSignal).toBeUndefined();
    expect(r.warning).toMatch(/grand total/i);
    expect(r.warning).toMatch(/double-counted/);
  });

  it('returns neither inside the +/-5% reconciliation band', () => {
    expect(classifyGrandTotalReconciliation(980, 1000)).toEqual({});
    expect(classifyGrandTotalReconciliation(1040, 1000)).toEqual({});
  });
});
