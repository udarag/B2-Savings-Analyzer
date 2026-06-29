/**
 * Maps a region identifier to a friendly place name for display. Keys span all providers' native
 * conventions in one table — AWS ids (us-east-1), GCP location labels (US Multi-region), and Azure
 * names (eastus) — plus bare GCP city names that show up on some bills, so lookups must tolerate any
 * of those shapes.
 */
export const REGION_LOCATION_LABELS: Record<string, string> = {
  'us-east-1': 'N. Virginia',
  'us-east-2': 'Ohio',
  'us-west-1': 'N. California',
  'us-west-2': 'Oregon',
  'ap-south-1': 'Mumbai',
  'ap-south-2': 'Hyderabad',
  'ap-southeast-1': 'Singapore',
  'ap-southeast-2': 'Sydney',
  'ap-southeast-3': 'Jakarta',
  'ap-southeast-4': 'Melbourne',
  'ap-southeast-5': 'Auckland',
  'ap-northeast-1': 'Tokyo',
  'ap-northeast-2': 'Seoul',
  'ap-northeast-3': 'Osaka',
  'ap-east-1': 'Hong Kong',
  'ap-east-2': 'Taipei',
  'eu-west-1': 'Ireland',
  'eu-west-2': 'London',
  'eu-west-3': 'Paris',
  'eu-central-1': 'Frankfurt',
  'eu-north-1': 'Stockholm',
  'eu-north-2': 'Copenhagen',
  'eu-south-1': 'Milan',
  'sa-east-1': 'Sao Paulo',
  'ca-central-1': 'Canada Central',
  'me-south-1': 'Bahrain',
  'af-south-1': 'Cape Town',
  EU: 'Europe',
  US: 'United States',
  GLOBAL: 'Global',
  'US Multi-region': 'US Multi-region',
  'EU Multi-region': 'EU Multi-region',
  'Asia Multi-region': 'Asia Multi-region',
  'US Regional': 'US Regional',
  'US Dual-region': 'US Dual-region',
  Iowa: 'Iowa',
  Oregon: 'Oregon',
  'South Carolina': 'South Carolina',
  'Northern Virginia': 'Northern Virginia',
  'Los Angeles': 'Los Angeles',
  Singapore: 'Singapore',
  Sydney: 'Sydney',
  Tokyo: 'Tokyo',
  Mumbai: 'Mumbai',
  Jakarta: 'Jakarta',
  Seoul: 'Seoul',
  Taiwan: 'Taiwan',
  'Hong Kong': 'Hong Kong',
  Finland: 'Finland',
  Netherlands: 'Netherlands',
  Belgium: 'Belgium',
  London: 'London',
  Frankfurt: 'Frankfurt',
  Warsaw: 'Warsaw',
  Zurich: 'Zurich',
  Montreal: 'Montreal',
  Toronto: 'Toronto',
  eastus: 'East US',
  eastus2: 'East US 2',
  westus: 'West US',
  westus2: 'West US 2',
  westus3: 'West US 3',
  centralus: 'Central US',
  northcentralus: 'North Central US',
  southcentralus: 'South Central US',
  canadacentral: 'Canada Central',
  northeurope: 'North Europe',
  westeurope: 'West Europe',
  uksouth: 'UK South',
  southeastasia: 'Southeast Asia',
  eastasia: 'East Asia',
};

/** Friendly place name for a region id, or null when the region is missing or unrecognized. */
export function getRegionLocation(region?: string): string | null {
  if (!region) return null;
  return REGION_LOCATION_LABELS[region] || null;
}

/** Display string combining a region id with its place name ("us-east-1 · N. Virginia"); degrades gracefully when either is absent. */
export function formatRegionWithLocation(region?: string): string {
  if (!region) return 'Region unknown';
  const location = getRegionLocation(region);
  return location ? `${region} · ${location}` : region;
}
