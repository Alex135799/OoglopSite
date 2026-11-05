import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Building, ModelDiff } from '../domain/types';
import { formatMW, formatNumber, formatPercent, itemName } from '../format';
import { usePlannerColors } from '../theme';

const fieldValue = (building: Building, field: 'typeId' | 'recipeId' | 'clock' | 'boost') => {
  switch (field) {
    case 'clock':
      return `${formatNumber(building.clock * 100, 1)}%`;
    case 'boost':
      return `${formatNumber(building.boost * 100, 1)}%`;
    case 'recipeId':
      return building.recipeId ?? '—';
    default:
      return building.typeId;
  }
};

const severityBadge = (severity: 'critical' | 'warning' | 'info') => {
  if (severity === 'critical') return <Chip size="small" label="critical" color="error" />;
  if (severity === 'warning') return <Chip size="small" label="warning" color="warning" />;
  return <Chip size="small" label="info" color="info" />;
};

const StatCard = ({ title, value, detail }: { title: string; value: string; detail: string }) => (
  <Card>
    <CardContent>
      <Typography variant="overline" color="text.secondary">{title}</Typography>
      <Typography variant="h4" className="planner-stat-value">{value}</Typography>
      <Typography variant="caption" className="planner-muted">{detail}</Typography>
    </CardContent>
  </Card>
);

export interface DiffViewProps {
  diff: ModelDiff;
}

export const DiffView = ({ diff }: DiffViewProps) => {
  const colors = usePlannerColors();
  const buildingChanges =
    diff.buildings.added.length +
    diff.buildings.removed.length +
    diff.buildings.changed.length;
  const lineChanges =
    diff.lines.added.length + diff.lines.removed.length + diff.lines.changed.length;

  return (
    <Box component="section" sx={{ mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }} aria-labelledby="planner-diff-heading">
      <Box className="planner-section-head">
        <Box>
          <Typography id="planner-diff-heading" variant="h5" component="h2">
            {diff.from.label} → {diff.to.label}
          </Typography>
          <Typography variant="caption" sx={{ color: colors.textOnBackgroundMuted }}>
            {diff.from.createdAt} → {diff.to.createdAt}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        <StatCard
          title="Buildings"
          value={formatNumber(buildingChanges)}
          detail={`+${diff.buildings.added.length} added · -${diff.buildings.removed.length} removed · ${diff.buildings.changed.length} changed`}
        />
        <StatCard
          title="Lines"
          value={formatNumber(lineChanges)}
          detail={`+${diff.lines.added.length} added · -${diff.lines.removed.length} removed · ${diff.lines.changed.length} changed`}
        />
        <StatCard
          title="Power delta"
          value={formatMW(diff.power.consumptionDelta)}
          detail={`generation ${formatMW(diff.power.generationDelta)} · headroom ${formatMW(diff.power.headroomDelta)}`}
        />
        <StatCard
          title="Coverage"
          value={formatPercent(diff.coverage.after.ratio)}
          detail={`${diff.coverage.ratioDelta >= 0 ? '+' : ''}${formatPercent(
            diff.coverage.ratioDelta,
          )} · ${diff.coverage.modeledDelta >= 0 ? '+' : ''}${diff.coverage.modeledDelta} modeled`}
        />
      </Box>

      <Typography variant="h6" component="h3" className="planner-diff-subhead">
        Building changes
      </Typography>
      {buildingChanges === 0 ? (
        <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>No building changes.</Typography>
      ) : (
        <TableContainer
          sx={{
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Table size="small" className="planner-diff-table">
            <TableHead>
              <TableRow>
                <TableCell>Building</TableCell>
                <TableCell>Change</TableCell>
                <TableCell>Before</TableCell>
                <TableCell>After</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {diff.buildings.added.map((building) => (
                <TableRow key={`added-${building.id}`}>
                  <TableCell>{building.displayName}</TableCell>
                  <TableCell><Chip size="small" label="added" color="success" /></TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>{building.recipeName ?? building.typeId}</TableCell>
                </TableRow>
              ))}
              {diff.buildings.removed.map((building) => (
                <TableRow key={`removed-${building.id}`}>
                  <TableCell>{building.displayName}</TableCell>
                  <TableCell><Chip size="small" label="removed" color="error" /></TableCell>
                  <TableCell>{building.recipeName ?? building.typeId}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              ))}
              {diff.buildings.changed.map((change) => (
                <TableRow key={`changed-${change.id}`}>
                  <TableCell>
                    {change.after.displayName}
                    <Typography variant="caption" className="planner-muted" component="div">
                      <code>{change.id.split('.').pop()}</code>
                    </Typography>
                  </TableCell>
                  <TableCell>{change.fields.join(', ')}</TableCell>
                  <TableCell>
                    {change.fields
                      .map((field) => `${field}: ${fieldValue(change.before, field)}`)
                      .join(' · ')}
                  </TableCell>
                  <TableCell>
                    {change.fields
                      .map((field) => `${field}: ${fieldValue(change.after, field)}`)
                      .join(' · ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="h6" component="h3" className="planner-diff-subhead">
        Line changes
      </Typography>
      {lineChanges === 0 ? (
        <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>No line changes.</Typography>
      ) : (
        <TableContainer
          sx={{
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Table size="small" className="planner-diff-table">
            <TableHead>
              <TableRow>
                <TableCell>Line</TableCell>
                <TableCell>Change</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Before → After</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {diff.lines.added.map((line) => (
                <TableRow key={`line-added-${line.key}`}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell><Chip size="small" label="added" color="success" /></TableCell>
                  <TableCell>{line.outputItems.map(itemName).join(', ') || '—'}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              ))}
              {diff.lines.removed.map((line) => (
                <TableRow key={`line-removed-${line.key}`}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell><Chip size="small" label="removed" color="error" /></TableCell>
                  <TableCell>{line.outputItems.map(itemName).join(', ') || '—'}</TableCell>
                  <TableCell>{line.buildingCount} buildings</TableCell>
                </TableRow>
              ))}
              {diff.lines.changed.map((change) => (
                <TableRow key={`line-changed-${change.key}`}>
                  <TableCell>{change.name}</TableCell>
                  <TableCell><Chip size="small" label="changed" color="secondary" /></TableCell>
                  <TableCell>
                    {change.rateDeltas.map((delta) => (
                      <Typography key={delta.itemId} variant="body2">
                        {itemName(delta.itemId)}
                      </Typography>
                    ))}
                  </TableCell>
                  <TableCell>
                    {change.rateDeltas.map((delta) => (
                      <Typography key={delta.itemId} variant="body2">
                        {formatNumber(delta.before)} → {formatNumber(delta.after)} (
                        {delta.delta >= 0 ? '+' : ''}
                        {formatNumber(delta.delta)})
                      </Typography>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="h6" component="h3" className="planner-diff-subhead">
        Findings
      </Typography>
      {diff.findings.added.length === 0 && diff.findings.resolved.length === 0 ? (
        <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>No finding changes.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" component="h4" className="planner-diff-list-head">
              New ({diff.findings.added.length})
            </Typography>
            {diff.findings.added.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>None.</Typography>
            ) : (
              <Box component="ul" className="planner-diff-findings">
                {diff.findings.added.map((finding) => (
                  <Box component="li" key={finding.id}>
                    {severityBadge(finding.severity)} {finding.message}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h4" className="planner-diff-list-head">
              Resolved ({diff.findings.resolved.length})
            </Typography>
            {diff.findings.resolved.length === 0 ? (
              <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>None.</Typography>
            ) : (
              <Box component="ul" className="planner-diff-findings">
                {diff.findings.resolved.map((finding) => (
                  <Box component="li" key={finding.id}>
                    {severityBadge(finding.severity)} {finding.message}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {diff.power.headroomDelta < 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Headroom fell by {formatMW(Math.abs(diff.power.headroomDelta))}.
        </Alert>
      )}
    </Box>
  );
};
