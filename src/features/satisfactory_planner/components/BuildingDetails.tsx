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
import type { Building } from '../domain/types';
import { formatMW, formatNumber, itemName, itemUnit } from '../format';
import { usePlannerColors } from '../theme';

export interface BuildingDetailsProps {
  building?: Building;
  onClose: () => void;
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => {
  const colors = usePlannerColors();
  return (
    <>
      <Typography component="dt" variant="body2" sx={{ color: colors.textMuted, fontWeight: 500 }}>{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, mb: { xs: 0.5, md: 0 } }}>{children}</Typography>
    </>
  );
};

export const BuildingDetails = ({ building, onClose }: BuildingDetailsProps) => {
  const colors = usePlannerColors();
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
          <Fact label="Clock">{formatNumber(building.clock * 100, 1)}%</Fact>
          <Fact label="Somersloop boost">{formatNumber(building.boost * 100, 1)}%</Fact>
          <Fact label="Power shards">{formatNumber(building.shards)}</Fact>
          <Fact label="Power use">{formatMW(building.powerConsumption)}</Fact>
          <Fact label="Power generation">{formatMW(building.powerGeneration)}</Fact>
          {building.location && (
            <Fact label="Position">
              {formatNumber(building.location.x)}, {formatNumber(building.location.y)},{' '}
              {formatNumber(building.location.z)}
            </Fact>
          )}
        </Box>

        {building.inputs.length > 0 && (
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

        {building.outputs.length > 0 && (
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
