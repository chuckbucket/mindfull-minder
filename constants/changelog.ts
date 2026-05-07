/**
 * App Revision Log
 *
 * Bullet prefix codes:
 *   (N) — New feature
 *   (F) — Bug fix
 *   (I) — Informational / improvement
 */

export interface ChangelogBullet {
  type: "N" | "F" | "I"
  text: string
}

export interface ChangelogEntry {
  version: string
  title: string
  date?: string
  bullets: string[] // each bullet starts with (N), (F), or (I)
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    title: "Initial release",
    date: "2026-05-6",
    bullets: [
      "(I) Initial release.",
      "(F) Fixed lots of bugs.",
      "(N) Added core features.",
    ],
  },
]
