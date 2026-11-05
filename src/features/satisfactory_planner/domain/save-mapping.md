# Save mapping (Satisfactory 1.2)

This document records how the planner turns raw parser output into the normalized model.
It is the reference for changing `normalizeSave.ts`, and it records confidence so future game
versions can be diagnosed quickly.

## Source parser

`@etothepii/satisfactory-file-parser` `4.1.2`, MIT. `Parser.ParseSave(name, ArrayBuffer)` is called
with `throwErrors: false`. Unknown properties are retained by the parser but ignored by the planner.

A save has `header` and `levels`. Objects live in `levels[levelName].objects` as `SaveEntity`
(buildings, world actors) and `SaveComponent` (inventories, power info, connections). References
are `{ levelName, pathName }`; `pathName` matches `SaveObject.instanceName`
(`Persistent_Level:PersistentLevel.<name>`). The planner indexes every object by `instanceName`
and resolves references through that map.

`typePath` is a class path such as
`/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C`;
the planner uses the final class segment (`Build_ConstructorMk1_C`).

## Production building detection

A `SaveEntity` is a production candidate when any of these holds:

- it has `mCurrentRecipe` (manufacturing buildings, including modded ones);
- it has `mExtractableResource` (miners, oil/water pumps, fracking extractors);
- its type is in the bundled generator map, contains `Generator`, or it has `mFuelInventory`;
- its type is a known machine and it has both `mInputInventory` and `mOutputInventory`.

Belts, pipes, foundations, storage, the hub and decorative buildables are not production
candidates. They are still counted in `counts.buildables` / `counts.entities` for transparency.

Coverage denominator = production candidates. Corrupt objects dropped by `throwErrors: false` are
invisible to the planner; coverage is computed from the objects the parser returned, not from the
save's declared object count.

Unmodeled candidates are still kept in the graph. They receive placeholder `unknown` inputs and
outputs at rate 0. If physical belt/pipe components place them in the same connectivity group as a
modeled line, they are attached to that line with a dashed zero-rate `unknown` edge labelled
`Unknown · 0/min`; otherwise they form standalone `(unknown)` lines. All rate math ignores entries at rate 0, so unknowns never change
balances, deficits or power totals.

The overview and line list only count lines with more than one building. The production summary
reports identified buildings (known machine/extractor/generator types or rate-modeled buildings)
in those connected lines over all production candidates. Single-building lines remain available
through findings and details, but are hidden from the line list.

## Manufacturing buildings

| Planner field | Save property | Confidence | Notes |
| --- | --- | --- | --- |
| `typeId` | `typePath` final class | High | Aliases normalize a few class renames. |
| `recipeId` | `mCurrentRecipe` reference | High | Reference is converted to `Recipe_*_C`. |
| `clock` | `mCurrentPotential`, then `mPendingPotential` | High | Omitted when 1.0. Clamped to >= 0.01. |
| `boost` | `mCurrentProductionBoost` | High | Float fraction; omitted when 0. |
| `shards` | stacks in `mInventoryPotential` | High | Counts `Desc_CrystalShard_C` items. |
| inputs/outputs | dataset recipe | High | `amount / duration * 60 * clock * (1 + boost)`. |
| power use | dataset machine `basePower` | Medium | `basePower * clock^powerExponent * (1 + boost)^boostPowerExponent`. |
| variable power | recipe `variablePower` | Medium | For low-base-power machines (Converter, Quantum Encoder, Particle Accelerator), the planner uses the maximum estimate `constant + factor`. |

Power shard slots are not used to infer clock speed: the save stores the actual potential, and a
shard can be installed without raising the clock.

## Extractors

| Planner field | Save property | Confidence | Notes |
| --- | --- | --- | --- |
| type | `typePath` in dataset `extractors` | High | Miner Mk1/2/3, oil pump, water extractor, fracking extractor. |
| output item | `mExtractableResource` → node `mResourceClassOverride` | High | Falls back to the miner's output inventory, then to the single input item of the nearest connected consumer through the belt/pipe graph, then to the dataset's single allowed resource (water/oil pumps). |
| purity | node `mPurityOverride` (`RP_Impure` 0.5, `RP_Normal` 1, `RP_Pure` 2) | High | Defaults to 1 when absent. |
| rate | dataset `baseRate` (items/min or m³/min) | High | `baseRate * purity * clock`. Fluid dataset rates are converted from litres to m³. |
| power | dataset `basePower` | Medium | `basePower * clock^powerExponent`; assumes full-load extraction. |

Fracking extractors without a resolvable resource are kept but unmodeled.

## Generators and power

- Generator type is resolved through the dataset generator map. `Build_GeneratorBiomass_C` and
  `Build_GeneratorIntegratedBiomass_C` are aliases for `Build_GeneratorBiomass_Automated_C`.
- Generation = dataset `powerProduction * clock`.
- Geothermal generators have no fixed dataset output; they stay unmodeled and are reported.
- Building power use comes from the recipe/machine estimate above. For unmodeled candidates the
  planner falls back to the power info component's `mTargetConsumption`, when present.
- Power summary is global. `CircuitSpecialProperties` exists on `BP_CircuitSubsystem_C`, but the
  spike did not establish a reliable building-to-circuit map for all versions, so per-circuit
  analysis is not shipped.

## Idle machines and connectivity

A known machine type with no `mCurrentRecipe` is idle and cannot contribute rates. The planner
marks it connected when any of its `FGFactoryConnectionComponent` or `FGPipeConnectionFactory`
children has a non-empty `mConnectedComponent`; otherwise it is unconnected. Connected idle
machines produce a warning, while all unconnected idle machines are combined into one info
finding, with their building links attached to the finding. This is a direct-component check, not
a full belt/pipe chain graph.

## Splitters

The planner reads actual `Build_*Splitter_C` entities from the save. It walks directed connection
components (`ConveyorAny0` input to `ConveyorAny1` output, splitter input to outputs, merger inputs
to output, pipe input/output sides) to find the upstream producers and downstream consumers of each
splitter. The splitter's `StorageInventory` supplies the item currently on it. The line graph renders
that actual splitter as a diamond `S` node between those buildings. Outgoing branches are divided
equally for now; exact splitter behavior and rate accounting will be refined later.

## Item-flow allocation

For each item, producer outputs are matched to consumer inputs proportionally. If supply is short,
every consumer receives a partial edge instead of filling the first consumer completely; if supply
is long, every producer gets a partial edge. This keeps deficit/surplus findings representative
and avoids showing an edge-less machine that still has a recipe input requirement.

## Belts, pipes and physical connectivity

- `FGFactoryConnectionComponent.mConnectedComponent` and
  `ConveyorChainActorSpecialProperties` expose physical connectivity, but conveyor chains store
  spline segments rather than one object per belt segment. Mapping a recipe flow to a specific
  chain without measured throughput is not reliable.
- Belt capacity is known from the dataset (`mSpeed / 2`, e.g. Mk.4 = 480/min) and pipe capacity
  from `mFlowLimit * 60` (Mk.1 = 300 m³/min), but the planner does **not** emit belt/pipe capacity
  findings in v1. `capacity` is therefore omitted rather than guessed. This is the documented
  fallback in the plan's risk section.
- The planner counts belts and pipes for context; it does not model their contents.

## Save header and versions

- `saveGameVersion` is displayed as `save <header.saveVersion> (build <header.buildVersion>)`.
- If `header.saveVersion` is greater than the dataset's `saveVersionMax`, the import is still
  allowed and a warning is shown.
- `header.isModdedSave` adds a warning. Modded buildings are imported and marked unmodeled.

## Alias map

| Save class | Dataset class | Reason |
| --- | --- | --- |
| `Build_GeneratorBiomass_C` | `Build_GeneratorBiomass_Automated_C` | Pre-1.2 class name. |
| `Build_GeneratorIntegratedBiomass_C` | `Build_GeneratorBiomass_Automated_C` | Modded integrated burner. |
| `Build_MinerMK1_C` | `Build_MinerMk1_C` | Casing difference in older saves. |

## Fixture and spike results

- Fixture: `fixtures/Another-1-2.sav`, 139,551 bytes, blob SHA
  `3627fd749a938391708676a9dea4ca7e6f9f037a`, from
  `etothepii4/satisfactory-file-parser` at commit `9574911`, `src/test/Another-1-2.sav` (MIT).
- `Another-1-2.sav` is a creative-mode 1.2 save with one Miner Mk.2 on a pure SAM node, two Mk.4
  belts and two conveyor poles. It intentionally exercises the extractor path rather than recipes.
- `Release-032.sav`, 530,536 bytes from the same tree, is a small real factory: 55 production
  candidates, 33 modeled buildings, 20 supply lines and 13 flows. It is the shipped demo save for
  exercising recipes, lines and findings.
- Parse time on this machine (Node 24, no worker): 85 ms for the fixture, about 3.5 s for the
  5.7 MB `269.sav` public save (108,628 objects).
- Memory is the main constraint: parsing `269.sav` added roughly 825 MB RSS / 460 MB heap in Node.
  The planner caps imports at 50 MB and runs parsing in a worker so the tab stays responsive, but
  very large saves can still exhaust memory.
- The built worker (`dist/assets/parseSave.worker-*.js`) was executed in Node with a `self` shim
  against the committed fixture: it produced the normalized model and one supply line, proving the
  Vite worker bundle runs after the production build.

## Known silent-loss caveat

With `throwErrors: false`, the parser may silently drop badly corrupt objects. The planner cannot
detect those objects. Coverage is therefore "of what the parser returned", not "of what the save
claims". This is preferable to inventing rates for objects that failed to parse, and it is stated
in the UI.
