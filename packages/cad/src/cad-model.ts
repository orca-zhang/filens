// cadkit-core 0.5.2's versioned drawing model, emitted by the frontend WASM core.
import type { CadPoint } from './preview-driver';

export type ModelPoint = CadPoint & { z: number };
export type ModelColor = { type: 'by_layer' | 'by_block' | 'aci' | 'rgb'; index?: number; r?: number; g?: number; b?: number };
export interface ModelStyle {
  layer?: string | null;
  color: ModelColor;
  linetype?: string | null;
  lineweight: { type: string; value?: number };
  visible: boolean;
  props: Record<string, unknown>;
}
interface ModelVertex {
  position: ModelPoint;
  bulge: number;
  start_width: number;
  end_width: number;
}
export type ModelHatchEdge =
  | { type: 'line'; start: ModelPoint; end: ModelPoint }
  | { type: 'arc'; center: ModelPoint; radius: number; start_angle: number; end_angle: number; ccw: boolean }
  | { type: 'ellipse'; center: ModelPoint; major_axis: ModelPoint; ratio: number; start_param: number; end_param: number; ccw: boolean }
  | { type: 'spline'; degree: number; knots: number[]; control_points: ModelPoint[]; weights: number[] }
  | { type: 'polyline'; vertices: ModelVertex[]; closed: boolean };
export type ModelGeometry =
  | { type: 'point'; position: ModelPoint }
  | { type: 'line'; start: ModelPoint; end: ModelPoint }
  | { type: 'circle'; center: ModelPoint; radius: number; normal: ModelPoint }
  | { type: 'arc'; center: ModelPoint; radius: number; start_angle: number; end_angle: number; normal: ModelPoint }
  | { type: 'ellipse'; center: ModelPoint; major_axis: ModelPoint; ratio: number; start_param: number; end_param: number; normal: ModelPoint }
  | { type: 'polyline'; vertices: ModelVertex[]; closed: boolean; normal: ModelPoint }
  | { type: 'spline'; degree: number; control_points: ModelPoint[]; fit_points: ModelPoint[]; closed: boolean }
  | { type: 'text'; position: ModelPoint; value: string; height: number; rotation: number; width_factor: number; oblique: number; style?: string | null; halign: string; valign: string; normal: ModelPoint }
  | { type: 'm_text'; position: ModelPoint; value: string; plain: string; height: number; rotation: number; style?: string | null; attachment: string; normal: ModelPoint }
  | { type: 'insert'; block: string; position: ModelPoint; scale: ModelPoint; rotation: number; columns: number; rows: number; column_spacing: number; row_spacing: number }
  | { type: 'dimension'; block?: string | null; points: ModelPoint[]; text_position?: ModelPoint | null; measurement?: number | null; text?: string | null }
  | { type: 'hatch'; loops: { edges: ModelHatchEdge[] }[]; solid: boolean; pattern?: string | null; normal: ModelPoint }
  | { type: 'face'; points: ModelPoint[] }
  | { type: 'leader'; vertices: ModelPoint[] }
  | { type: 'image'; path?: string | null; position: ModelPoint; u_vector: ModelPoint; v_vector: ModelPoint; size_px?: [number, number] | null }
  | { type: 'mesh'; vertices: ModelPoint[]; faces: number[][] }
  | { type: 'group'; children: ModelEntity[] }
  | { type: 'unknown'; type_name: string }
  | { type: 'viewport' | 'polygon' };
export interface ModelEntity extends ModelStyle {
  kind: ModelGeometry;
  attributes: { value: string; position?: ModelPoint | null; invisible: boolean; layer?: string | null; display?: { height: number; rotation: number; style?: string | null; halign: string; valign: string } | null }[];
}
export interface CadModel {
  schema_version: number;
  source: { format: string; version: string };
  units: { unit: string };
  layers: (ModelStyle & { name: string; frozen: boolean; locked: boolean })[];
  linetypes: { name: string; description?: string | null; pattern: number[] }[];
  text_styles: { name: string; font?: string | null }[];
  blocks: { name: string; base_point: ModelPoint; entities: ModelEntity[] }[];
  models: { kind: string; entities: ModelEntity[] }[];
  warnings: { message: string }[];
}
