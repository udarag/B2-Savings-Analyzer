// Single source of truth for the "as of" pricing date shown on customer reports. Centralized here so
// the label lives in one place instead of being retyped on each report surface — update it when the
// pricing tables are refreshed. Dependency-free so both server and client report code can import it.
//
// NEEDS-DECISION (product): whether this should stay a hand-updated label or be derived automatically
// (e.g. from the pricing-refresh run date). Kept as a manual constant for now; changing the approach
// only touches this file.
export const PRICING_AS_OF_LABEL = 'June 2026';
