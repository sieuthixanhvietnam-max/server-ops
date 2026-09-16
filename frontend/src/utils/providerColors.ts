/** Tag color per hosting provider - shared so the same provider always gets
 * the same color regardless of which page renders it (Domains, Servers,
 * Domain Changes all show this same field). */
export const PROVIDER_COLORS: Record<string, string> = {
  GCP: 'blue',
  Ali: 'orange',
  DO: 'purple',
};
