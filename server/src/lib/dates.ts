export function calculateDays(startDate: string): number {
  const start = new Date(startDate);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - start.getTime();
  const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return days + 1;
}
