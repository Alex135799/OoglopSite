import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Building, SupplyNode } from '../domain/types';
import { formatMW, formatNumber, itemName, itemUnit } from '../format';
import { productionBoostMultiplier } from '../domain/rateMath';
import { plannerColors, usePlannerColors } from '../theme';
import { StorageContents } from './StorageContents';

export interface BuildingDetailsProps {
  building?: Building;
  supplyNode?: SupplyNode;
  onClose: () => void;
}

interface GroupedPort {
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unknown: boolean;
}

const groupPorts = (
  ports: Array<{ itemId: string; expectedRate: number; actualRate: number; unknown?: boolean }>,
): GroupedPort[] => [
  ...ports
    .reduce((groups, port) => {
      const entry = groups.get(port.itemId) ?? {
        itemId: port.itemId,
        expectedRate: 0,
        actualRate: 0,
        unknown: false,
      };
      entry.expectedRate += port.expectedRate;
      entry.actualRate += port.actualRate;
      entry.unknown ||= port.unknown === true;
      groups.set(port.itemId, entry);
      return groups;
    }, new Map<string, GroupedPort>())
    .values(),
];

const Fact = ({ label, children }: { label: string; children: ReactNode }) => {
  const colors = usePlannerColors();
  return (
    <>
      <Typography component="dt" variant="body2" sx={{ color: colors.textMuted, fontWeight: 500 }}>{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, mb: { xs: 0.5, md: 0 } }}>{children}</Typography>
    </>
  );
};

const formatRecipeSide = (entries: Array<{ itemId: string; amount: number }>): string =>
  entries
    .map((entry) => `${formatNumber(entry.amount)} ${itemName(entry.itemId)}`)
    .join(' + ');

export const BuildingDetails = ({ building, supplyNode, onClose }: BuildingDetailsProps) => {
  const colors = usePlannerColors();
  const supplyInputs = supplyNode && supplyNode.type !== 'source' ? supplyNode.inputs : [];
  const supplyOutputs = supplyNode?.outputs ?? [];
  const groupedSupplyInputs = groupPorts(supplyInputs);
  const groupedSupplyOutputs = groupPorts(supplyOutputs);
  if (!building && supplyNode?.type === 'control') {
    const inputTotal = groupedSupplyInputs.reduce((sum, port) => sum + port.actualRate, 0);
    const outputTotal = groupedSupplyOutputs.reduce((sum, port) => sum + port.actualRate, 0);
    const reduction = supplyNode.bottleneck
      ? Math.max(0, supplyNode.expectedThroughput - outputTotal)
      : 0;
    const itemId =
      supplyNode.itemId ??
      groupedSupplyInputs[0]?.itemId ??
      groupedSupplyOutputs[0]?.itemId ??
      'unknown';
    const unit = itemUnit(itemId);
    const kindLabel =
      supplyNode.kind === 'splitter'
        ? 'Splitter'
        : supplyNode.kind === 'merger'
          ? 'Merger'
          : supplyNode.kind === 'junction'
            ? 'Pipeline Junction'
            : supplyNode.kind === 'tank'
              ? 'Fluid Storage'
              : 'Storage';

    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
            <Box>
              <Typography variant="h6" component="h2">{kindLabel}</Typography>
              <Typography component="code" className="planner-muted" sx={{ wordBreak: 'break-all' }}>{supplyNode.id}</Typography>
            </Box>
            <Button variant="outlined" size="small" onClick={onClose} aria-label="Close details">
              Close
            </Button>
          </Box>

          <Box className="planner-badges">
            <Chip size="small" label={kindLabel} variant="outlined" />
            <Chip size="small" label={itemName(itemId)} variant="outlined" />
            {supplyNode.bottleneck && (
              <Chip
                size="small"
                color="warning"
                label={
                  supplyNode.bottleneckReason === 'demand'
                    ? 'demand-limited'
                    : 'belt-limited'
                }
                variant="outlined"
              />
            )}
          </Box>

          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'max-content 1fr' },
              gap: 0.5,
              my: 2,
              fontSize: '0.9rem',
            }}
          >
            <Fact label="Input">{formatNumber(inputTotal)} {unit}</Fact>
            <Fact label="Output">{formatNumber(outputTotal)} {unit}</Fact>
            {supplyNode.bottleneck && (
              <Fact label="Capacity reduction">{formatNumber(reduction)} {unit}</Fact>
            )}
          </Box>

          {supplyNode.bottleneck && (
            <Typography
              variant="body2"
              sx={{
                mb: 2,
                p: 1,
                borderLeft: '3px solid',
                borderLeftColor: plannerColors.warning.color,
                bgcolor: colors.warningSurface,
                fontSize: '0.9rem',
              }}
            >
              {supplyNode.bottleneckReason === 'demand'
                ? `Downstream demand limits throughput: expected ${formatNumber(supplyNode.expectedThroughput)} ${unit}, delivered ${formatNumber(outputTotal)} ${unit}.`
                : `Output belts reduce throughput by ${formatNumber(reduction)} ${unit}: ${formatNumber(inputTotal)} input → ${formatNumber(outputTotal)} delivered.`}
            </Typography>
          )}

          {groupedSupplyInputs.length > 0 && (
            <>
              <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
                Inputs
              </Typography>
              <Table size="small" className="planner-rate-table">
                <TableBody>
                  {groupedSupplyInputs.map((input) => (
                    <TableRow key={input.itemId}>
                      <TableCell>{itemName(input.itemId)}</TableCell>
                      <TableCell align="right">
                        {input.unknown ? 'unknown' : formatNumber(input.actualRate)}{' '}
                        {itemUnit(input.itemId)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {groupedSupplyOutputs.length > 0 && (
            <>
              <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
                Outputs
              </Typography>
              <Table size="small" className="planner-rate-table">
                <TableBody>
                  {groupedSupplyOutputs.map((output) => (
                    <TableRow key={output.itemId}>
                      <TableCell>{itemName(output.itemId)}</TableCell>
                      <TableCell align="right">
                        {output.unknown ? 'unknown' : formatNumber(output.actualRate)}{' '}
                        {itemUnit(output.itemId)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {supplyNode.kind === 'storage' || supplyNode.kind === 'tank' ? <StorageContents contents={supplyNode.contents} /> : null}

          {supplyNode.notes && supplyNode.notes.length > 0 && (
            <>
              <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
                Notes
              </Typography>
              <List dense disablePadding>
                {supplyNode.notes.map((note) => (
                  <ListItem key={note} disableGutters>
                    <ListItemText primary={note} slotProps={{ primary: { variant: 'body2' } }} />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </CardContent>
      </Card>
    );
  }
  if (!building) {
    return (
      <Card>
        <CardContent className="planner-empty">
          <Typography>Select a building to see its recipe, rates and power.</Typography>
          <Typography className="planner-muted">
            Click a node in the graph, or a building link in the findings list.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
          <Box>
            <Typography variant="h6" component="h2">{building.displayName}</Typography>
            <Typography component="code" className="planner-muted" sx={{ wordBreak: 'break-all' }}>{building.id}</Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={onClose} aria-label="Close details">
            Close
          </Button>
        </Box>

        <Box className="planner-badges">
          <Chip
            size="small"
            label={building.modeled ? 'modeled' : 'unmodeled'}
            color={building.modeled ? 'success' : 'warning'}
            variant="outlined"
          />
          <Chip size="small" label={building.typeId} variant="outlined" />
          {building.recipeId && (
            <Chip size="small" color="secondary" variant="outlined" label={building.recipeId} />
          )}
        </Box>

        {!building.modeled && (
          <Typography
            variant="body2"
            sx={{
              mt: 1.5,
              mb: 1.5,
              p: 1,
              borderLeft: '3px solid',
              borderLeftColor: 'primary.main',
              bgcolor: colors.surfaceHighlight,
              fontSize: '0.9rem',
            }}
          >
            This building is excluded from rate math. Its power is reported where the save exposes
            it.
          </Typography>
        )}

        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'max-content 1fr' },
            gap: 0.5,
            my: 2,
            fontSize: '0.9rem',
          }}
        >
          {building.recipeName && <Fact label="Recipe">{building.recipeName}</Fact>}
          {building.selectedFuel && (
            <Fact label="Fuel">{itemName(building.selectedFuel)}</Fact>
          )}
          {building.fuelBuffer && (
            <Fact label="Fuel duration">
              {formatNumber(building.fuelBuffer.runtimeMinutes)} min
            </Fact>
          )}
          <Fact label="Clock">{formatNumber(building.clock * 100, 1)}%</Fact>
          <Fact label="Somersloop boost">{formatNumber(building.boost * 100, 1)}%</Fact>
          {building.recipeInputs && building.recipeOutputs && (
            <>
              <Fact label="Recipe ratio">
                {formatRecipeSide(building.recipeInputs)} → {formatRecipeSide(building.recipeOutputs)}
              </Fact>
              {productionBoostMultiplier(building.boost) > 1 && (
                <Fact label="Boosted ratio">
                  {formatRecipeSide(building.recipeInputs)} →{' '}
                  {formatRecipeSide(
                    building.recipeOutputs.map((entry) => ({
                      ...entry,
                      amount: entry.amount * productionBoostMultiplier(building.boost),
                    })),
                  )}
                </Fact>
              )}
            </>
          )}
          <Fact label="Power shards">{formatNumber(building.shards)}</Fact>
          <Fact label="Power use">
            {formatMW(building.powerConsumption)}
            {supplyNode?.type === 'transformer' && supplyNode.actualPower !== supplyNode.expectedPower
              ? ` / ${formatMW(supplyNode.actualPower)} actual`
              : ''}
          </Fact>
          <Fact label="Power generation">
            {formatMW(building.powerGeneration)}
            {supplyNode?.type === 'transformer' &&
            supplyNode.actualPowerGeneration !== supplyNode.expectedPowerGeneration
              ? ` / ${formatMW(supplyNode.actualPowerGeneration)} actual`
              : ''}
          </Fact>
          {building.location && (
            <Fact label="Position">
              {formatNumber(building.location.x)}, {formatNumber(building.location.y)},{' '}
              {formatNumber(building.location.z)}
            </Fact>
          )}
        </Box>

        {supplyNode?.type === 'transformer' && supplyNode.limitedBy === 'demand' && (
          <Typography
            variant="body2"
            sx={{
              mb: 2,
              p: 1,
              borderLeft: '3px solid',
              borderLeftColor: plannerColors.info.color,
              bgcolor: colors.surfaceHighlight,
              fontSize: '0.9rem',
            }}
          >
            Downstream demand is limiting this machine.
          </Typography>
        )}

        {supplyInputs.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
              Inputs
            </Typography>
            <Table size="small" className="planner-rate-table">
              <TableBody>
                {supplyInputs.map((input) => (
                  <TableRow key={input.id}>
                    <TableCell>{itemName(input.itemId)}</TableCell>
                    <TableCell align="right">
                      {formatNumber(input.expectedRate)} expected ·{' '}
                      {input.unknown ? 'unknown' : formatNumber(input.actualRate)} actual{' '}
                      {itemUnit(input.itemId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {groupedSupplyOutputs.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
              Outputs
            </Typography>
            <Table size="small" className="planner-rate-table">
              <TableBody>
                {groupedSupplyOutputs.map((output) => (
                  <TableRow key={output.itemId}>
                    <TableCell>{itemName(output.itemId)}</TableCell>
                    <TableCell align="right">
                      {formatNumber(output.expectedRate)} expected ·{' '}
                      {output.unknown ? 'unknown' : formatNumber(output.actualRate)} actual{' '}
                      {itemUnit(output.itemId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {!supplyNode && building.inputs.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
              Inputs
            </Typography>
            <Table size="small" className="planner-rate-table">
              <TableBody>
                {building.inputs.map((input) => (
                  <TableRow key={input.itemId}>
                    <TableCell>{itemName(input.itemId)}</TableCell>
                    <TableCell align="right">
                      {formatNumber(input.rate)} {itemUnit(input.itemId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {!supplyNode && building.outputs.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
              Outputs
            </Typography>
            <Table size="small" className="planner-rate-table">
              <TableBody>
                {building.outputs.map((output) => (
                  <TableRow key={output.itemId}>
                    <TableCell>{itemName(output.itemId)}</TableCell>
                    <TableCell align="right">
                      {formatNumber(output.rate)} {itemUnit(output.itemId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {building.notes && building.notes.length > 0 && (
          <>
            <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
              Notes
            </Typography>
            <List dense disablePadding>
              {building.notes.map((note) => (
                <ListItem key={note} disableGutters>
                  <ListItemText primary={note} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </CardContent>
    </Card>
  );
};
