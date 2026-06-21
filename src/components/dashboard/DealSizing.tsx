'use client';

import { formatCurrency } from '../shared/FormatCurrency';

const B2_LIST_PRICE_PER_TB = 6.95;

interface DealSizingProps {
  b2PricePerTb: number;
  onB2PriceChange: (price: number) => void;
  monthlyB2Revenue: number;
  termMonths: number;
  totalStorageGb: number;
  udmEnabled: boolean;
  onUdmChange: (enabled: boolean) => void;
  udmCostToBackblaze: number;
}

export function DealSizing({
  b2PricePerTb,
  onB2PriceChange,
  monthlyB2Revenue,
  termMonths,
  totalStorageGb,
  udmEnabled,
  onUdmChange,
  udmCostToBackblaze,
}: DealSizingProps) {
  const annualRevenue = monthlyB2Revenue * 12;
  const termValue = monthlyB2Revenue * termMonths;

  const listMonthlyRevenue = totalStorageGb * (B2_LIST_PRICE_PER_TB / 1000);
  const listTermValue = listMonthlyRevenue * termMonths;
  const revenueDelta = termValue - listTermValue;
  const isCustom = Math.abs(b2PricePerTb - B2_LIST_PRICE_PER_TB) > 0.001;

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-bb-red">
      <div className="px-5 py-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">Deal Sizing</h4>
        <p className="text-xs text-gray-500">Internal only — B2 revenue estimate</p>
      </div>
      <div className="p-5 space-y-4">
        {/* B2 price control */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            B2 Price per TB/month
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">$</span>
            <input
              type="number"
              min={1}
              max={20}
              step={0.05}
              value={b2PricePerTb}
              onChange={(e) => onB2PriceChange(Math.max(0.01, Number(e.target.value) || B2_LIST_PRICE_PER_TB))}
              className="w-24 px-2 py-1.5 border rounded text-sm font-medium"
            />
            {isCustom && (
              <button
                onClick={() => onB2PriceChange(B2_LIST_PRICE_PER_TB)}
                className="text-xs text-bb-red hover:underline"
              >
                Reset to list
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            List: ${B2_LIST_PRICE_PER_TB}/TB
            {isCustom && b2PricePerTb < B2_LIST_PRICE_PER_TB && ` · ${((1 - b2PricePerTb / B2_LIST_PRICE_PER_TB) * 100).toFixed(1)}% discount`}
            {isCustom && b2PricePerTb > B2_LIST_PRICE_PER_TB && ` · ${(((b2PricePerTb / B2_LIST_PRICE_PER_TB) - 1) * 100).toFixed(1)}% premium`}
          </p>
        </div>

        {/* UDM Toggle */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-medium text-gray-600">Universal Data Migration</label>
              <p className="text-xs text-gray-400">Backblaze covers migration egress</p>
            </div>
            <button
              onClick={() => onUdmChange(!udmEnabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                udmEnabled ? 'bg-bb-red' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  udmEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>
          {udmEnabled && (() => {
            const b2BreakEven = monthlyB2Revenue > 0
              ? Math.ceil(udmCostToBackblaze / monthlyB2Revenue)
              : null;
            return (
              <div className="mt-2 bg-bb-red-light rounded p-2.5 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-bb-red-dark">B2 UDM Cost (at $0.03/GB)</span>
                  <span className="font-semibold text-bb-navy">{formatCurrency(udmCostToBackblaze)}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {(totalStorageGb / 1000).toFixed(1)} TB × $0.03/GB — one-time cost to Backblaze
                </p>
                <div className="flex justify-between text-xs border-t border-red-200 pt-2">
                  <span className="text-bb-red-dark">B2 UDM Break-even</span>
                  <span className="font-semibold text-bb-navy">
                    {b2BreakEven !== null
                      ? `Month ${b2BreakEven}`
                      : 'N/A'}
                  </span>
                </div>
                {b2BreakEven !== null && (
                  <p className="text-xs text-gray-500">
                    {formatCurrency(udmCostToBackblaze)} UDM cost ÷ {formatCurrency(monthlyB2Revenue)}/mo revenue
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Monthly B2 Revenue</span>
            <span className="font-semibold">{formatCurrency(monthlyB2Revenue)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Annual B2 Revenue</span>
            <span className="font-semibold">{formatCurrency(annualRevenue)}</span>
          </div>
          <div className="border-t pt-2">
            <p className="text-xs text-gray-500 mb-0.5">{termMonths}-Month Contract Value</p>
            <p className="text-xl font-bold text-bb-navy">{formatCurrency(termValue)}</p>
          </div>
        </div>

        {/* Revenue impact vs list */}
        {isCustom && (
          <div className={`border-t pt-3 ${revenueDelta < 0 ? 'text-red-700' : 'text-green-700'}`}>
            <p className="text-xs font-medium text-gray-600 mb-1">Revenue vs. List Price</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{termMonths}-mo at list (${B2_LIST_PRICE_PER_TB}/TB)</span>
              <span className="text-gray-600 font-medium">{formatCurrency(listTermValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{termMonths}-mo at ${b2PricePerTb}/TB</span>
              <span className="font-medium">{formatCurrency(termValue)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t mt-1 pt-1">
              <span>{revenueDelta < 0 ? 'Revenue Impact' : 'Revenue Uplift'}</span>
              <span>{revenueDelta < 0 ? '' : '+'}{formatCurrency(revenueDelta)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
