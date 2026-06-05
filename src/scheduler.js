import cron from 'node-cron';

export function startScheduler(callback) {
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * 1-5';
  if (!cron.validate(schedule)) {
    console.error(`❌ Invalid CRON_SCHEDULE: "${schedule}"`);
    process.exit(1);
  }
  console.log(`⏰ Scheduler started. Schedule: "${schedule}" (weekdays 7am by default)`);
  cron.schedule(schedule, () => {
    console.log(`⏰ Scheduled run triggered`);
    callback();
  });
}
