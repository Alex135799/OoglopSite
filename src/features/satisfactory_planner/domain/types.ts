export type Severity = 'critical' | 'warning' | 'info';

export type ItemForm = 'solid' | 'liquid' | 'gas' | 'unknown';

export interface ItemRate {
  itemId: string;
  rate: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Building {
  id: string;
  typeId: string;
  displayName: string;
  recipeId?: string;
  recipeName?: string;
  clock: number;
  boost: number;
  shards: number;
  inputs: ItemRate[];
  outputs: ItemRate[];
  powerConsumption: number;
  powerGeneration: number;
  modeled: boolean;
  knownType?: boolean;
  connected?: boolean;
  physicalGroup?: string;
  location?: Vec3;
  notes?: string[];
}

export interface LineFlow {
  from: string;
  to: string;
  itemId: string;
  rate: number;
}

export interface LineBalance {
  itemId: string;
  supply: number;
  demand: number;
}

export interface ProductionLine {
  id: string;
  name: string;
  outputItems: string[];
  buildingIds: string[];
  flows: LineFlow[];
  balance: LineBalance[];
}

export interface PowerSummary {
  generation: number;
  consumption: number;
  headroom: number;
  headroomRatio: number;
  generators: number;
  consumers: number;
  unmodeledGenerators: number;
}

export type FindingKind =
  | 'power_deficit'
  | 'line_deficit'
  | 'line_surplus'
  | 'belt_over_capacity'
  | 'pipe_over_capacity'
  | 'missing_recipe'
  | 'unmodeled';

export interface Finding {
  id: string;
  severity: Severity;
  kind: FindingKind;
  message: string;
  lineId?: string;
  buildingIds?: string[];
  itemId?: string;
  required?: number;
  available?: number;
  unit?: string;
}

export interface TransportRun {
  id: string;
  medium: 'belt' | 'pipe';
  typeId: string;
  fromNodeId: string;
  toNodeId: string;
  itemId?: string;
  capacity?: number;
  segmentCount: number;
  segmentIds: string[];
}

export interface SplitterNode {
  id: string;
  typeId: string;
  kind: 'splitter' | 'merger' | 'storage';
  itemId?: string;
  inputs: string[];
  outputs: string[];
  directInputs?: string[];
  directOutputs?: string[];
  inputRoles?: { id: string; role: 'sink' | 'continuation' }[];
  outputRoles?: { id: string; role: 'tap' | 'continuation' }[];
}

export interface Coverage {
  totalBuildings: number;
  modeledBuildings: number;
  ratio: number;
  unmodeledTypes: { typeId: string; count: number }[];
}

export interface SaveCounts {
  entities: number;
  buildables: number;
  productionBuildings: number;
  belts: number;
  pipes: number;
}

export interface NormalizedSave {
  schemaVersion: number;
  gameDataVersion: string;
  saveGameVersion: string;
  importedAt: string;
  source: {
    fileName: string;
    sha256: string;
    size: number;
  };
  buildings: Building[];
  transportNodes?: SplitterNode[];
  transportRuns?: TransportRun[];
  splitters?: SplitterNode[];
  lines: ProductionLine[];
  power: PowerSummary;
  findings: Finding[];
  coverage: Coverage;
  counts: SaveCounts;
  warnings: string[];
}

export interface SupplyInputPort {
  id: string;
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unknown?: boolean;
  previousNodeId?: string;
  notes?: string[];
}

export interface SupplyOutputPort {
  id: string;
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unknown?: boolean;
  nextNodeId?: string;
  notes?: string[];
}

interface SupplyNodeBase {
  id: string;
  displayName: string;
  producerIds?: string[];
  position?: Vec3;
  notes?: string[];
}

export interface SupplySourceNode extends SupplyNodeBase {
  type: 'source';
  outputs: SupplyOutputPort[];
  clock: number;
  boost: number;
  shards: number;
  expectedPower: number;
  actualPower: number;
}

export interface SupplyTransformerNode extends SupplyNodeBase {
  type: 'transformer';
  kind: 'machine' | 'generator' | 'sink';
  recipeId?: string;
  recipeName?: string;
  inputs: SupplyInputPort[];
  outputs: SupplyOutputPort[];
  clock: number;
  boost: number;
  shards: number;
  expectedPower: number;
  actualPower: number;
  expectedPowerGeneration: number;
  actualPowerGeneration: number;
}

export interface SupplyControlNode extends SupplyNodeBase {
  type: 'control';
  kind: 'splitter' | 'merger' | 'storage';
  itemId?: string;
  inputs: SupplyInputPort[];
  outputs: SupplyOutputPort[];
  expectedThroughput: number;
  actualThroughput: number;
  buffered?: boolean;
}

export interface SupplyTransportNode extends SupplyNodeBase {
  type: 'transport';
  inputs: SupplyInputPort[];
  outputs: SupplyOutputPort[];
  medium: 'belt' | 'pipe';
  itemId?: string;
  capacity?: number;
  expectedRate: number;
  actualRate: number;
  unknown?: boolean;
  segmentCount?: number;
  fromNodeId?: string;
  toNodeId?: string;
}

export type SupplyNode =
  | SupplySourceNode
  | SupplyTransformerNode
  | SupplyControlNode
  | SupplyTransportNode;

export interface SupplyRateSummary {
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unit: 'items/min' | 'm³/min';
  unknown?: boolean;
}

export interface SupplyLineSummary {
  inputs: SupplyRateSummary[];
  outputs: SupplyRateSummary[];
  power: {
    expectedConsumption: number;
    actualConsumption: number;
    expectedGeneration: number;
    actualGeneration: number;
  };
  bottlenecks: {
    nodeId: string;
    itemId?: string;
    expectedRate: number;
    actualRate: number;
    reason: string;
  }[];
}

export interface SupplyLineModel {
  id: string;
  name: string;
  roots: string[];
  nodes: Record<string, SupplyNode>;
  summary: SupplyLineSummary;
  notes: string[];
  buildingIds: string[];
  transportNodeIds: string[];
}

export interface BuildingChange {
  id: string;
  before: Building;
  after: Building;
  fields: ('typeId' | 'recipeId' | 'clock' | 'boost')[];
}

export interface LineSummary {
  key: string;
  name: string;
  outputItems: string[];
  buildingCount: number;
  balance: LineBalance[];
}

export interface LineRateDelta {
  itemId: string;
  before: number;
  after: number;
  delta: number;
}

export interface LineChange {
  key: string;
  name: string;
  before: LineSummary;
  after: LineSummary;
  rateDeltas: LineRateDelta[];
}

export interface ModelDiff {
  from: { label: string; createdAt: string };
  to: { label: string; createdAt: string };
  buildings: {
    added: Building[];
    removed: Building[];
    changed: BuildingChange[];
  };
  lines: {
    added: LineSummary[];
    removed: LineSummary[];
    changed: LineChange[];
  };
  power: {
    before: PowerSummary;
    after: PowerSummary;
    generationDelta: number;
    consumptionDelta: number;
    headroomDelta: number;
  };
  coverage: {
    before: Coverage;
    after: Coverage;
    ratioDelta: number;
    modeledDelta: number;
  };
  findings: {
    added: Finding[];
    resolved: Finding[];
  };
}

export interface CheckpointMeta {
  id: string;
  label: string;
  createdAt: string;
  saveHash: string;
}

export interface CheckpointRecord extends CheckpointMeta {
  model: NormalizedSave;
}

export interface StoredSaveMeta {
  hash: string;
  fileName: string;
  size: number;
  gameVersion: string;
  importedAt: string;
}

export type ParsePhase = 'reading' | 'parsing' | 'normalizing' | 'done';

export interface ParseProgress {
  phase: ParsePhase;
  progress: number;
  message?: string;
}

export type PlannerErrorCode =
  | 'INVALID_FILE'
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'PARSE_FAILED'
  | 'EMPTY_SAVE'
  | 'WORKER_CRASH'
  | 'ABORTED';

export interface PlannerError {
  code: PlannerErrorCode;
  message: string;
  detail?: string;
}
