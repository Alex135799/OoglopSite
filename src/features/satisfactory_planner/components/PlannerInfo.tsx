import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

export const PlannerInfo = () => (
  <Card>
    <CardContent>
      <Typography variant="h5" component="h2">What it does</Typography>
      <Box component="ul" sx={{ mb: 2, pl: 3 }}>
        <li>Groups machines by recipe and builds item-flow supply lines.</li>
        <li>
          Estimates power, line deficits and surpluses from recipes, clock speed, somersloop boost
          and the bundled 1.2 dataset.
        </li>
        <li>
          Keeps unknown or modded production buildings visible as unmodeled instead of inventing
          rates.
        </li>
      </Box>
      <Typography variant="h5" component="h2">What it does not do</Typography>
      <Box component="ul" sx={{ mb: 2, pl: 3 }}>
        <li>It does not upload or write back save files.</li>
        <li>It does not measure live belt throughput or resolve full belt capacity yet.</li>
      </Box>
    </CardContent>
  </Card>
);
