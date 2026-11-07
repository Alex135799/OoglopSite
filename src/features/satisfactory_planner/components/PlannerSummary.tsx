import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { NormalizedSave } from '../domain/types';
import type { PlannerAnalysis } from '../domain/analyzeModel';
import { summarizeFindings } from '../domain/detectBottlenecks';
import { formatMW, formatNumber, formatPercent } from '../format';
import { usePlannerColors } from '../theme';

export interface PlannerSummaryProps {
  model: NormalizedSave;
  analysis: PlannerAnalysis;
}

export const PlannerSummary = ({ model, analysis }: PlannerSummaryProps) => {
  const colors = usePlannerColors();
  const findings = summarizeFindings(analysis.findings);
  const lineStats = analysis.lineStats;
  const powerColor =
    model.power.headroom < 0
      ? 'error'
      : model.power.headroomRatio < 0.1
        ? 'warning'
        : 'success';

  return (
    <Box component="section" aria-labelledby="planner-summary-heading">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography id="planner-summary-heading" variant="h5" component="h2">
            {model.source.fileName}
          </Typography>
          <Typography variant="caption" sx={{ color: colors.textOnBackgroundMuted }}>
            Imported {new Date(model.importedAt).toLocaleString()} · SHA-256{' '}
            <code>{model.source.sha256.slice(0, 12)}…</code>
          </Typography>
        </Box>
        <Box className="planner-badges">
          <Chip size="small" color="primary" label={`Game data ${model.gameDataVersion}`} />
          <Chip size="small" color="secondary" label={model.saveGameVersion} variant="outlined" />
          <Chip size="small" label={`${(model.source.size / 1024).toFixed(0)} KB`} variant="outlined" />
        </Box>
      </Box>

      {model.warnings.map((warning) => (
        <Alert key={warning} severity="warning" sx={{ mb: 1, py: 1, px: 1.5 }}>
          {warning}
        </Alert>
      ))}

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
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Production buildings</Typography>
            <Typography variant="h4" className="planner-stat-value">
              {formatNumber(lineStats.buildingsInLines)} /{' '}
              {formatNumber(lineStats.totalCandidates)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <LinearProgress
                variant="determinate"
                value={Math.round(lineStats.ratio * 100)}
                color={lineStats.ratio === 1 ? 'success' : 'warning'}
                sx={{ flex: 1, height: 6, borderRadius: 3 }}
              />
              <Typography variant="caption">{formatPercent(lineStats.ratio)}</Typography>
            </Box>
            <Typography variant="caption" className="planner-muted">
              Identified buildings in multi-building lines / production candidates
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Supply lines</Typography>
            <Typography variant="h4" className="planner-stat-value">
              {formatNumber(lineStats.buildingsInLines)} / {formatNumber(lineStats.totalCandidates)}
            </Typography>
            <Typography variant="caption" className="planner-muted">
              {formatNumber(lineStats.activeLines.length)} lines ·{' '}
              {formatNumber(lineStats.flows)} flows · {formatNumber(model.counts.belts)} belts ·{' '}
              {formatNumber(model.counts.pipes)} pipes
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Power</Typography>
            <Typography variant="h4" className="planner-stat-value">
              {formatMW(model.power.consumption)}
            </Typography>
            <Typography variant="caption" className="planner-muted">
              demand · {formatMW(model.power.generation)} modeled generation
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Chip
                size="small"
                color={powerColor}
                label={`${model.power.headroom >= 0 ? 'Headroom ' : 'Deficit '}${formatMW(
                  Math.abs(model.power.headroom),
                )}`}
              />
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Estimated findings</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <Chip size="small" color="error" label={`${findings.critical} critical`} />
              <Chip size="small" color="warning" label={`${findings.warning} warning`} />
              <Chip size="small" color="info" label={`${findings.info} info`} />
            </Box>
            <Typography variant="caption" className="planner-muted">
              Static estimates from recipes, clock speed and power
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Box
        sx={{
          mt: 3,
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: colors.surfaceMuted,
          color: colors.textSecondary,
        }}
      >
        <Typography variant="body2" sx={{ mb: 1 }}>
          <strong>{formatNumber(model.counts.entities)}</strong> save objects ·{' '}
          <strong>{formatNumber(model.counts.buildables)}</strong> player-built structures ·{' '}
          <strong>{formatNumber(model.counts.productionBuildings)}</strong> production candidates
        </Typography>
        <Typography variant="body2" className="planner-muted" sx={{ mb: 1 }}>
          Belt and pipe capacity is not resolved in this version, so physical capacity findings are
          omitted rather than guessed. Known machines or extractors with missing save data are
          reported in Findings; only unsupported or modded building types are listed here.
        </Typography>
        {model.coverage.unmodeledTypes.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Typography component="span" variant="caption" className="planner-muted">
              Unsupported types:
            </Typography>
            {model.coverage.unmodeledTypes.slice(0, 6).map((entry) => (
              <Chip
                key={entry.typeId}
                size="small"
                variant="outlined"
                sx={{ border: 1, borderColor: 'divider', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                label={`${entry.typeId.replace(/_C$/, '')} × ${entry.count}`}
              />
            ))}
            {model.coverage.unmodeledTypes.length > 6 && (
              <Typography component="span" variant="caption" className="planner-muted">
                +{model.coverage.unmodeledTypes.length - 6} more
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
