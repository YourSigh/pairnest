import type { PeriodRecord } from '@prisma/client';

export function hasOverlap(
  records: Pick<PeriodRecord, 'startDate' | 'endDate'>[],
  startDate: string,
  endDate?: string | null
): boolean {
  const start = startDate;
  const end = endDate ?? '9999-12-31';

  return records.some((record) => {
    const rStart = record.startDate;
    const rEnd = record.endDate ?? '9999-12-31';
    return start <= rEnd && end >= rStart;
  });
}
