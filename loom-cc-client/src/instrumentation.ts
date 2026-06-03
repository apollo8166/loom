/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the cron engine so scheduled tasks fire automatically.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronEngine } = await import('@/shared/runtime/cron/engine')
    startCronEngine()
  }
}
