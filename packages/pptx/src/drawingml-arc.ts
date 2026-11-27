import type { CustomShapeCubicCommand } from '@filens/core/presentation-support';

const turn = 21600000;
const tau = Math.PI * 2;

export function resolveDrawingMlArc(
  point: { x: number; y: number }, rx: number, ry: number, startAngle: number, sweepAngle: number
) {
  if (rx <= 0 || ry <= 0 || sweepAngle === 0) return undefined;

  const parameter = (angle: number) => {
    const polar = (angle % turn) * tau / turn;
    return Math.atan2(rx * Math.sin(polar), ry * Math.cos(polar));
  };
  const start = parameter(startAngle);
  const remainder = sweepAngle % turn;
  const direction = Math.sign(sweepAngle);
  const end = parameter(startAngle % turn + remainder);
  const partial = remainder === 0 ? 0 : (direction * (end - start) + tau) % tau;
  // Repeated turns have the same outline. Retain one revolution and the authored endpoint.
  const sweep = direction * (partial + (Math.abs(sweepAngle) >= turn ? tau : 0));
  if (sweep === 0) return undefined;
  const cx = point.x - rx * Math.cos(start);
  const cy = point.y - ry * Math.sin(start);
  return { start, end, sweep, cx, cy, closes: remainder === 0 };
}

/** Lower a DrawingML ellipse arc to the existing cubic path model. */
export function customArcAsCubics(
  point: { x: number; y: number }, rx: number, ry: number, startAngle: number, sweepAngle: number
): CustomShapeCubicCommand[] | undefined {
  if (rx < 0 || ry < 0) return undefined;
  const arc = resolveDrawingMlArc(point, rx, ry, startAngle, sweepAngle);
  if (!arc) return [];
  const { start, end, sweep, cx, cy, closes } = arc;
  const segments = Math.ceil(Math.abs(sweep) / (Math.PI / 4));
  const step = sweep / segments;
  const tangentScale = 4 / 3 * Math.tan(step / 4);
  const commands: CustomShapeCubicCommand[] = [];
  let current = point;
  for (let index = 0; index < segments; index++) {
    const a = start + index * step;
    const b = index + 1 === segments ? end : a + step;
    const lastFullTurn = index + 1 === segments && closes;
    const x = lastFullTurn ? point.x : cx + rx * Math.cos(b);
    const y = lastFullTurn ? point.y : cy + ry * Math.sin(b);
    const command = {
      type: 'C' as const,
      x1: current.x - tangentScale * rx * Math.sin(a),
      y1: current.y + tangentScale * ry * Math.cos(a),
      x2: x + tangentScale * rx * Math.sin(b),
      y2: y - tangentScale * ry * Math.cos(b),
      x, y
    };
    if (![command.x1, command.y1, command.x2, command.y2, x, y].every(Number.isFinite)) return undefined;
    commands.push(command);
    current = command;
  }
  return commands;
}
