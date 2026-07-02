// Alternative "why it matters" framings for the commit-upsell customer report. The pitch is always
// throughput headroom (never a fabricated dollar saving), but *which* capabilities land depends on the
// customer's workload — an AI/ML shop, a post house, and a backup team each care about different
// things. The AE picks the angle on the internal deal-sizing dashboard; the customer report renders
// the chosen angle's three capability points. Copy is deliberately qualitative — the report hero
// already carries the concrete throughput multipliers, so these never restate numbers or invent
// figures. Dependency-free so both the dashboard and the report can import it.

export interface AnglePoint {
  title: string;
  body: string;
}

export interface CommitUpsellAngle {
  id: string;
  /** Short label for the AE's angle picker. */
  label: string;
  /** One-line hint shown under the picker so the AE can match the angle to the account. */
  hint: string;
  /** Exactly three points — the report renders a fixed three-up capability strip. */
  points: [AnglePoint, AnglePoint, AnglePoint];
}

/** The one angle whose points come from the AE, not the presets below. */
export const CUSTOM_ANGLE_ID = 'custom';

export const COMMIT_UPSELL_ANGLES: CommitUpsellAngle[] = [
  {
    id: 'throughput',
    label: 'General throughput',
    hint: 'Broadly applicable — performance, headroom, no throttling.',
    points: [
      { title: 'Faster restores', body: 'Pull large datasets back without hitting a bandwidth wall.' },
      { title: 'No burst throttling', body: 'Concurrent jobs stop competing for one shared ceiling.' },
      { title: 'Room to grow', body: 'Headroom for years of growth before the tier is a constraint again.' },
    ],
  },
  {
    id: 'ai-ml',
    label: 'AI / ML training',
    hint: 'GPU utilization, parallel reads, checkpointing.',
    points: [
      { title: 'Keep GPUs fed', body: "Stream training data fast enough that expensive accelerators aren't left idle." },
      { title: 'Parallel reads at scale', body: 'Many workers pull shards at once without contending for bandwidth.' },
      { title: 'Checkpoint cleanly', body: 'Write large model checkpoints without stalling the training run.' },
    ],
  },
  {
    id: 'media',
    label: 'Media & post',
    hint: 'Editorial pulls, concurrent seats, ingest bursts.',
    points: [
      { title: 'Faster media pulls', body: 'Editors and render nodes fetch large assets without waiting on the network.' },
      { title: 'Concurrent access', body: 'Many seats and render jobs hit storage at once without slowing down.' },
      { title: 'Absorb ingest bursts', body: 'Camera-to-cloud and dailies spikes land without throttling.' },
    ],
  },
  {
    id: 'backup-dr',
    label: 'Backup & DR',
    hint: 'RTOs, full-scale restores, growing backup sets.',
    points: [
      { title: 'Meet tighter RTOs', body: 'Restore more data inside the window your recovery targets allow.' },
      { title: 'Restore under pressure', body: "Full-scale recoveries don't bottleneck on a low bandwidth ceiling." },
      { title: 'Grows with your data', body: 'Backup sets keep growing; the throughput ceiling grows with them.' },
    ],
  },
  {
    id: 'app-storage',
    label: 'Application storage',
    hint: 'Serving customer-facing data straight from your stack.',
    points: [
      { title: 'Serve users directly', body: 'Stream assets to end users straight from B2 without a bandwidth ceiling in the path.' },
      { title: 'Handle traffic spikes', body: 'Absorb launch days and viral peaks without requests backing up behind a rate limit.' },
      { title: 'Scale with your users', body: 'Add users and objects without re-architecting around a throughput cap.' },
    ],
  },
  {
    // The Custom angle's points here are placeholder examples only — when it's selected the report
    // renders the AE's own points (B2UsageInput.customAnglePoints), and the dashboard shows these as
    // the input placeholders. See resolveCommitUpsellPoints below.
    id: CUSTOM_ANGLE_ID,
    label: 'Custom',
    hint: 'Write your own three points for this account.',
    points: [
      { title: 'Faster restores', body: 'Pull large datasets back without hitting a bandwidth wall.' },
      { title: 'No burst throttling', body: 'Concurrent jobs stop competing for one shared ceiling.' },
      { title: 'Room to grow', body: 'Headroom for years of growth before the tier is a constraint again.' },
    ],
  },
];

/** Resolve a stored angle id to its angle, falling back to the default (General throughput). */
export function getCommitUpsellAngle(id?: string): CommitUpsellAngle {
  return COMMIT_UPSELL_ANGLES.find((angle) => angle.id === id) ?? COMMIT_UPSELL_ANGLES[0];
}

/**
 * The points the report should actually render for the chosen angle. For a preset that's just the
 * angle's fixed points; for the Custom angle it's the AE's own points (blank slots dropped). If Custom
 * is selected but nothing has been written yet, we fall back to the default angle so the report never
 * shows empty cards.
 */
export function resolveCommitUpsellPoints(id: string | undefined, customPoints?: AnglePoint[]): AnglePoint[] {
  if (id === CUSTOM_ANGLE_ID) {
    const filled = (customPoints ?? [])
      .map((p) => ({ title: (p.title ?? '').trim(), body: (p.body ?? '').trim() }))
      .filter((p) => p.title || p.body);
    if (filled.length > 0) return filled.slice(0, 3);
    return getCommitUpsellAngle('throughput').points;
  }
  return getCommitUpsellAngle(id).points;
}
