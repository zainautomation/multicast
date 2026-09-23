/** Public base URL of the app: APP_URL, else the Vercel production/deployment URL, else localhost. */
export function appUrl(): string {
  const v = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return v.replace(/\/$/, "");
}
