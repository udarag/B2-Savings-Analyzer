'use client';

import type { EgressConfig } from '@/types/analysis';

interface EgressQuestionnaireProps {
  config: EgressConfig;
  onChange: (config: EgressConfig) => void;
}

export function EgressQuestionnaire({ config, onChange }: EgressQuestionnaireProps) {
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Egress Configuration</h3>
        <p className="text-sm text-gray-500 mt-1">
          How the customer accesses their data affects egress costs.
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* Q1: Compute location */}
        <div>
          <p className="font-medium text-gray-900 mb-3">
            Does the customer use hyperscaler compute to process data before writing to storage?
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="computeLocation"
                checked={!config.computeStaysInHyperscaler}
                onChange={() => onChange({
                  ...config,
                  computeStaysInHyperscaler: false,
                  computeMovingToPartner: false,
                  gbPerMonthHyperscalerToB2: 0,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red"
              />
              <div>
                <p className="text-sm font-medium">No hyperscaler compute in the pipeline</p>
                <p className="text-xs text-gray-500">Data goes directly to B2 — no inter-cloud egress</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="computeLocation"
                checked={config.computeStaysInHyperscaler && !config.computeMovingToPartner}
                onChange={() => onChange({
                  ...config,
                  computeStaysInHyperscaler: true,
                  computeMovingToPartner: false,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red"
              />
              <div>
                <p className="text-sm font-medium">Compute stays in hyperscaler</p>
                <p className="text-xs text-gray-500">Data egresses from hyperscaler to B2 — new egress cost applies</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="computeLocation"
                checked={config.computeStaysInHyperscaler && config.computeMovingToPartner}
                onChange={() => onChange({
                  ...config,
                  computeStaysInHyperscaler: true,
                  computeMovingToPartner: true,
                  gbPerMonthHyperscalerToB2: 0,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red"
              />
              <div>
                <p className="text-sm font-medium">Compute moving to B2 partner (CoreWeave, Vultr, etc.)</p>
                <p className="text-xs text-gray-500">Free egress between B2 and partner compute</p>
              </div>
            </label>
          </div>
        </div>

        {/* Q2: Egress volume (if compute stays in hyperscaler) */}
        {config.computeStaysInHyperscaler && !config.computeMovingToPartner && (
          <div>
            <label className="block font-medium text-gray-900 mb-2">
              Estimated GB/month transferred from hyperscaler to B2
            </label>
            <input
              type="number"
              min={0}
              value={config.gbPerMonthHyperscalerToB2}
              onChange={(e) => onChange({
                ...config,
                gbPerMonthHyperscalerToB2: Math.max(0, Number(e.target.value) || 0),
              })}
              className="w-48 px-3 py-2 border rounded-lg text-sm"
              placeholder="e.g., 5000"
            />
          </div>
        )}

        {/* Q3: End-user egress */}
        <div>
          <label className="block font-medium text-gray-900 mb-2">
            Estimated GB/month served to end users or external consumers
          </label>
          <input
            type="number"
            min={0}
            value={config.gbPerMonthServedToUsers}
            onChange={(e) => onChange({
              ...config,
              gbPerMonthServedToUsers: Math.max(0, Number(e.target.value) || 0),
            })}
            className="w-48 px-3 py-2 border rounded-lg text-sm"
            placeholder="e.g., 10000"
          />
        </div>

        {/* Q4: CDN */}
        <div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.usesPartnerCdn}
              onChange={(e) => onChange({
                ...config,
                usesPartnerCdn: e.target.checked,
              })}
              className="h-4 w-4 text-bb-red accent-bb-red rounded"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">
                Uses or plans to use a B2 CDN partner (Cloudflare, Fastly, bunny.net)
              </p>
              <p className="text-xs text-gray-500">
                B2 egress to CDN partners is free
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
