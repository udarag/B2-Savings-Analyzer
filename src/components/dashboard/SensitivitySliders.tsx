'use client';

interface SensitivitySlidersProps {
  growthRate: number;
  onGrowthRateChange: (rate: number) => void;
}

export function SensitivitySliders({
  growthRate,
  onGrowthRateChange,
}: SensitivitySlidersProps) {
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Sensitivity Analysis</h3>
      </div>
      <div className="p-6">
        <div>
          <div className="flex justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Annual Data Growth Rate
            </label>
            <span className="text-sm font-semibold text-gray-900">{growthRate}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={growthRate}
            onChange={(e) => onGrowthRateChange(Number(e.target.value))}
            className="w-full accent-bb-red"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
