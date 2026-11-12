import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import type { Finding, ProductionLine, Severity, SupplyLineModel } from '../domain/types';
import { formatNumber, itemName } from '../format';
import { plannerColors, usePlannerColors } from '../theme';

const INITIAL_LINES = 40;

const isSupplyLine = (line: SupplyLineModel | ProductionLine): line is SupplyLineModel =>
  'summary' in line;

const severityForLine = (
  line: SupplyLineModel | ProductionLine,
  findings: Finding[],
): Severity | undefined => {
  const ids = new Set(line.buildingIds);
  const forLine = findings.filter(
    (finding) =>
      finding.lineId === line.id ||
      finding.buildingIds?.some((buildingId) => ids.has(buildingId)),
  );
  if (forLine.some((finding) => finding.severity === 'critical')) return 'critical';
  if (forLine.some((finding) => finding.severity === 'warning')) return 'warning';
  if (forLine.some((finding) => finding.severity === 'info')) return 'info';
  return undefined;
};

const badgeFor = (severity: Severity | undefined) => {
  switch (severity) {
    case 'critical':
      return <Chip size="small" label="critical" color="error" />;
    case 'warning':
      return <Chip size="small" label="warning" color="warning" />;
    case 'info':
      return <Chip size="small" label="info" color="info" />;
    default:
      return <Chip size="small" label="ok" color="success" variant="outlined" />;
  }
};

export interface LineListProps {
  lines: (SupplyLineModel | ProductionLine)[];
  findings: Finding[];
  selectedLineId?: string;
  onSelect: (lineId: string) => void;
}

export const LineList = ({ lines, findings, selectedLineId, onSelect }: LineListProps) => {
  const colors = usePlannerColors();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? lines : lines.slice(0, INITIAL_LINES);

  if (lines.length === 0) {
    return (
      <Box className="planner-empty">
        <Typography>No connected supply lines yet.</Typography>
        <Typography className="planner-muted">
          Single unconnected buildings are hidden, or the save has no connected production
          buildings.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <List disablePadding>
        {visible.map((line) => {
          const severity = severityForLine(line, findings);
          const supply = isSupplyLine(line);
          const deficits = supply
            ? line.summary.inputs
                .filter((entry) => entry.expectedRate > entry.actualRate + 1e-6)
                .map((entry) => ({
                  itemId: entry.itemId,
                  supply: entry.actualRate,
                  demand: entry.expectedRate,
                }))
            : line.balance
                .filter((entry) => entry.demand > entry.supply + 1e-6)
                .map((entry) => ({
                  itemId: entry.itemId,
                  supply: entry.supply,
                  demand: entry.demand,
                }));
          const outputItems = supply
            ? line.summary.outputs.map((entry) => entry.itemId)
            : line.outputItems;
          return (
            <ListItemButton
              key={line.id}
              selected={line.id === selectedLineId}
              onClick={() => onSelect(line.id)}
              aria-current={line.id === selectedLineId ? 'true' : undefined}
              sx={{
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 0.5,
                borderLeft: '3px solid',
                borderLeftColor:
                  line.id === selectedLineId ? 'primary.main' : 'transparent',
                py: 1,
              }}
            >
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
                <Typography component="span" sx={{ fontWeight: 600 }}>{line.name}</Typography>
                {badgeFor(severity)}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', mt: 0.5, color: colors.textSecondary, fontSize: '0.82rem' }}>
                <Typography component="span" variant="caption">
                  {formatNumber(line.buildingIds.length)} buildings
                </Typography>
                {outputItems.slice(0, 3).map((itemId) => (
                  <Chip
                    key={itemId}
                    size="small"
                    label={itemName(itemId)}
                    variant="outlined"
                  />
                ))}
                {outputItems.length > 3 && (
                  <Typography component="span" variant="caption" className="planner-muted">
                    +{outputItems.length - 3}
                  </Typography>
                )}
              </Box>
              {deficits.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5, color: plannerColors.critical.color, fontSize: '0.8rem' }}>
                  {deficits.slice(0, 2).map((entry) => (
                    <Typography component="span" variant="caption" key={entry.itemId}>
                      {itemName(entry.itemId)}: {formatNumber(entry.supply)} /{' '}
                      {formatNumber(entry.demand)}
                    </Typography>
                  ))}
                  {deficits.length > 2 && (
                    <Typography component="span" variant="caption">
                      +{deficits.length - 2} more
                    </Typography>
                  )}
                </Box>
              )}
            </ListItemButton>
          );
        })}
      </List>
      {lines.length > INITIAL_LINES && !showAll && (
        <Button variant="text" size="small" onClick={() => setShowAll(true)} sx={{ pl: 0 }}>
          Show all {lines.length} lines
        </Button>
      )}
    </Box>
  );
};
