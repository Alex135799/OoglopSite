import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import type { Finding } from '../domain/types';
import { formatNumber } from '../format';
import { usePlannerColors } from '../theme';

const severityBadge = (finding: Finding) => {
  switch (finding.severity) {
    case 'critical':
      return <Chip size="small" label="critical" color="error" />;
    case 'warning':
      return <Chip size="small" label="warning" color="warning" />;
    default:
      return <Chip size="small" label="info" color="info" />;
  }
};

export interface FindingsPanelProps {
  findings: Finding[];
  onSelectBuilding?: (buildingId: string) => void;
}

export const FindingsPanel = ({ findings, onSelectBuilding }: FindingsPanelProps) => {
  const colors = usePlannerColors();
  if (findings.length === 0) {
    return (
      <Box className="planner-empty">
        <Typography>No estimated bottlenecks found.</Typography>
        <Typography className="planner-muted">
          The static rules found no power, line or coverage problems in the modeled content.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <List disablePadding>
        {findings.map((finding) => (
          <ListItem key={finding.id} sx={{ display: 'block', py: 1.5, px: 1.8 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              {severityBadge(finding)}
              <Typography component="span">{finding.message}</Typography>
            </Box>
            {(finding.required !== undefined || finding.available !== undefined) && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.5, color: colors.textSecondary, fontSize: '0.8rem' }}>
                {finding.required !== undefined && (
                  <Typography component="span" variant="caption">
                    required {formatNumber(finding.required)}
                  </Typography>
                )}
                {finding.available !== undefined && (
                  <Typography component="span" variant="caption">
                    available {formatNumber(finding.available)}
                  </Typography>
                )}
                {finding.unit && (
                  <Typography component="span" variant="caption">{finding.unit}</Typography>
                )}
              </Box>
            )}
            {finding.buildingIds && finding.buildingIds.length > 0 && onSelectBuilding && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', mt: 0.5 }}>
                {finding.buildingIds.slice(0, 4).map((buildingId) => (
                  <Button
                    key={buildingId}
                    variant="text"
                    size="small"
                    onClick={() => onSelectBuilding(buildingId)}
                  >
                    {buildingId.split('.').pop()}
                  </Button>
                ))}
                {finding.buildingIds.length > 4 && (
                  <Typography component="span" variant="caption" className="planner-muted">
                    +{finding.buildingIds.length - 4} more
                  </Typography>
                )}
              </Box>
            )}
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
