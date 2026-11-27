import type { ChartDateAxis, ChartTimeUnit } from '@filens/core/presentation-support';
import SSF from 'ssf';

const DAY = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 31);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const MARCH_1900 = Date.UTC(1900, 2, 1);
const LAST_1900_DATE = 2_958_465;
const EPOCH_OFFSET = 1_462;

export function isChartDateSerial(value: number, date1904: boolean): boolean {
  return value >= 0 && value < LAST_1900_DATE - (date1904 ? EPOCH_OFFSET : 0) + 1;
}

export function formatChartDate(serial: number, axis: ChartDateAxis): string {
  const options = { date1904: axis.date1904 };
  if (axis.formatCode && axis.formatCode.length <= 255) {
    try {
      return SSF.format(axis.formatCode, serial, options);
    } catch {
      // Keep labels readable when a chart uses a format SSF cannot interpret.
    }
  }
  return SSF.format('m/d/yyyy', serial, options);
}

function calendarSerial(timestamp: number, date1904: boolean): number {
  return date1904 ? (timestamp - EPOCH_1904) / DAY
    : (timestamp - EPOCH_1900) / DAY + Number(timestamp >= MARCH_1900);
}

function shiftDate(serial: number, unit: ChartTimeUnit, amount: number, date1904: boolean): number {
  if (amount === 0) return serial;
  if (unit === 'days') return serial + amount;
  const { y, m, d } = SSF.parse_date_code(serial, { date1904 });
  const first = new Date(Date.UTC(y, m - 1 + amount * (unit === 'years' ? 12 : 1), 1));
  const year = first.getUTCFullYear(), month = first.getUTCMonth();
  const syntheticFebruary = !date1904 && year === 1900 && month === 1;
  const lastDay = syntheticFebruary ? 29 : new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, d), lastDay);
  return syntheticFebruary && day === 29 ? 60 : calendarSerial(Date.UTC(year, month, day), date1904);
}

function floorDate(serial: number, unit: ChartTimeUnit, date1904: boolean): number {
  if (unit === 'days') return Math.floor(serial);
  const { y, m } = SSF.parse_date_code(Math.floor(serial), { date1904 });
  return calendarSerial(Date.UTC(y, unit === 'years' ? 0 : m - 1, 1), date1904);
}

function dateTicks(first: number, last: number, unit: ChartTimeUnit, interval: number, date1904: boolean): number[] {
  const shortest = unit === 'years' ? 365 : unit === 'months' ? 28 : 1;
  const stride = Math.max(1, Math.ceil((last - first) / (shortest * interval * 100)));
  const ticks = [];
  for (let index = 0; index <= 100; index++) {
    const serial = shiftDate(first, unit, index * stride * interval, date1904);
    if (!(serial <= last)) break;
    ticks.push(serial);
  }
  return ticks;
}

export function resolveChartDates(axis: ChartDateAxis) {
  const { date1904 } = axis;
  const base = axis.baseTimeUnit ?? 'days';
  const project = (serial: number) => Math.max(0, floorDate(serial, base, date1904));
  const serials = axis.serials.map(serial => serial == null ? null : project(serial));
  const indices = serials.flatMap((serial, index) => serial == null ? [] : [index])
    .sort((a, b) => axis.serials[a]! - axis.serials[b]!);
  const dataFirst = serials[indices[0]], dataLast = serials[indices[indices.length - 1]];
  if (dataFirst == null || dataLast == null) return undefined;

  const min = axis.min !== undefined && isChartDateSerial(axis.min, date1904) ? project(axis.min) : undefined;
  const max = axis.max !== undefined && isChartDateSerial(axis.max, date1904) ? project(axis.max) : undefined;
  const first = Math.min(max ?? Infinity, min ?? dataFirst);
  const last = Math.max(first, max ?? dataLast);
  const prior = shiftDate(first, base, -1, date1904);
  const next = shiftDate(last, base, 1, date1904);
  const domain = (between: boolean) => {
    if (first === last) {
      if (min !== undefined && max === undefined) return { min: first, max: next };
      if (max !== undefined && min === undefined) return { min: prior, max: last };
      return { min: (first + prior) / 2, max: (last + next) / 2 };
    }
    return {
      min: between && min === undefined ? (first + prior) / 2 : first,
      max: between && max === undefined ? (last + next) / 2 : last
    };
  };
  const bandwidth = (serial: number) => shiftDate(serial, base, 1, date1904) - serial;
  const majorTimeUnit = axis.majorTimeUnit ?? base;
  const approximateDays = majorTimeUnit === 'years' ? 365 : majorTimeUnit === 'months' ? 30 : 1;
  const guess = Math.max(1, Math.ceil((last - first) / (5 * approximateDays)));
  const interval = Math.max(1, Math.min(LAST_1900_DATE, Math.floor(axis.majorUnit ?? guess)));
  const majorTicks = dateTicks(first, last, majorTimeUnit, interval, date1904);
  const minorInterval = Math.max(1, Math.min(LAST_1900_DATE, Math.floor(axis.minorUnit ?? 1)));
  const minorTicks = axis.showMinorGridlines || (axis.minorTickMark && axis.minorTickMark !== 'none')
    ? dateTicks(first, last, axis.minorTimeUnit ?? base, minorInterval, date1904).filter(serial => !majorTicks.includes(serial))
    : [];
  return { axis, serials, indices, domain, bandwidth, majorTicks, minorTicks };
}
