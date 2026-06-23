import type { ParsedLineItem } from '@/types/analysis';
import { getColdTierAccessSummary, isColdTierAccessItem, type AccessCostSummary } from './access-costs';

export type B2TransactionClassId = 'class-a' | 'class-b' | 'class-c' | 'class-a-c' | 'class-d' | 'other';

export interface ActionCostDetail {
  currentCost: number;
  lineCount: number;
  usageQuantity: number;
  usageUnit?: string;
}

export interface OperationActionCostSummary {
  putRelated: ActionCostDetail;
  getRelated: ActionCostDetail;
  coldTierAccess: AccessCostSummary;
  distinctCurrentCost: number;
  distinctLineCount: number;
}

export function getOperationActionCostSummary(lineItems: ParsedLineItem[]): OperationActionCostSummary {
  const putItems = lineItems.filter(isPutRelatedStandardOperation);
  const getItems = lineItems.filter(isGetRelatedStandardOperation);
  const coldTierAccess = getColdTierAccessSummary(lineItems);
  const distinctItems = new Map<string, ParsedLineItem>();

  for (const item of lineItems) {
    if (
      isPutRelatedStandardOperation(item) ||
      isGetRelatedStandardOperation(item) ||
      isColdTierAccessItem(item)
    ) {
      distinctItems.set(item.id, item);
    }
  }

  return {
    putRelated: summarizeActionCost(putItems),
    getRelated: summarizeActionCost(getItems),
    coldTierAccess,
    distinctCurrentCost: round2(
      Array.from(distinctItems.values()).reduce((sum, item) => sum + item.costUsd, 0),
    ),
    distinctLineCount: distinctItems.size,
  };
}

export function isPutRelatedStandardOperation(item: ParsedLineItem): boolean {
  if (item.category !== 'operations') return false;

  const classId = isReviewOnlyOperation(item.subcategory)
    ? 'other'
    : classifyTransactionClass(item);

  return classId !== 'other' && classId !== 'class-d' && isPutRelatedTransaction(item);
}

export function isGetRelatedStandardOperation(item: ParsedLineItem): boolean {
  if (item.category !== 'operations') return false;

  const classId = isReviewOnlyOperation(item.subcategory)
    ? 'other'
    : classifyTransactionClass(item);

  return classId !== 'other' && classId !== 'class-d' && isGetRelatedTransaction(item);
}

export function isPutRelatedTransaction(item: ParsedLineItem): boolean {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (subcategory === 'put/copy/post/list' || subcategory === 'class a') return true;

  return [
    'put',
    'putobject',
    'post',
    'copyobject',
    'copy object',
    'upload',
    'write',
    'delete',
    'insert',
    'compose',
  ].some((signal) => text.includes(signal));
}

export function isGetRelatedTransaction(item: ParsedLineItem): boolean {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (subcategory === 'get/select' || subcategory === 'class b') return true;

  return [
    'get',
    'getobject',
    'download',
    'read',
    'select',
    'headobject',
    'head object',
    'file information',
  ].some((signal) => text.includes(signal));
}

export function classifyTransactionClass(item: ParsedLineItem): B2TransactionClassId {
  const subcategory = (item.subcategory || '').toLowerCase();
  const description = `${item.description} ${item.sku}`.toLowerCase();
  const text = `${subcategory} ${description}`;

  if (text.includes('event notification')) return 'class-d';
  if (subcategory === 'class a') return 'class-a';
  if (subcategory === 'class b') return 'class-b';
  if (subcategory === 'put/copy/post/list') return 'class-a-c';
  if (subcategory === 'get/select') return 'class-b';

  if (text.includes('put') || text.includes('post') || text.includes('upload') || text.includes('write') || text.includes('delete')) {
    return 'class-a';
  }

  if (
    text.includes('get') ||
    text.includes('download') ||
    text.includes('read') ||
    text.includes('headobject') ||
    text.includes('head object') ||
    text.includes('file information')
  ) {
    return 'class-b';
  }

  if (text.includes('list') || text.includes('copyobject') || text.includes('copy object') || text.includes('bucket')) {
    return 'class-c';
  }

  return 'other';
}

export function isReviewOnlyOperation(subcategory?: string): boolean {
  const key = (subcategory || '').toLowerCase();
  return [
    'monitoring/analytics',
    's3 inventory',
    'lifecycle transitions',
    'lifecycle/copy',
    'tag storage',
    'metadata',
    's3 select',
    'other requests',
    'other s3',
  ].includes(key);
}

function summarizeActionCost(items: ParsedLineItem[]): ActionCostDetail {
  const units = new Set(items.map((item) => item.usageUnit).filter(Boolean));

  return {
    currentCost: round2(items.reduce((sum, item) => sum + item.costUsd, 0)),
    lineCount: items.length,
    usageQuantity: round2(items.reduce((sum, item) => sum + (item.usageQuantity || 0), 0)),
    usageUnit: units.size === 1 ? Array.from(units)[0] : undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
