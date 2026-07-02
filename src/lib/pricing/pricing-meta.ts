// Single source of truth for the "as of" pricing date shown on customer reports.
//
// Auto-derived from the report-generation date (there is no pricing-refresh timestamp on the pricing
// JSON to key off, and B2/R2 rates are static assumptions while AWS/GCP are refreshed in place — so
// the honest label for a report generated today is "as of this month"). Computed on each call rather
// than at module load so a long-running server never serves a frozen month.
//
// Dependency-free so both server and client report code can import it.
export function pricingAsOfLabel(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
