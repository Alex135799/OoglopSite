import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { StorageStack } from '../domain/types';
import { formatNumber, itemName, itemStackSize } from '../format';
import { storageStackColor, usePlannerColors } from '../theme';

export interface StorageContentsProps {
  contents?: StorageStack[];
}

export const StorageContents = ({ contents }: StorageContentsProps) => {
  const colors = usePlannerColors();
  const stacks = contents ?? [];
  const legend = [...new Map(stacks.map((stack) => [stack.itemId, stack])).values()];
  const totals = new Map<string, number>();
  for (const stack of stacks) {
    totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.amount);
  }

  return (
    <>
      <Typography variant="subtitle2" component="h3" className="planner-details-subhead">
        Contents
      </Typography>
      {stacks.length === 0 ? (
        <Typography variant="body2" className="planner-muted">
          Empty
        </Typography>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 28px)',
              gap: 0.75,
              mt: 1.5,
              mb: 1.5,
            }}
          >
            {stacks.map((stack, index) => {
              const size = Math.max(1, itemStackSize(stack.itemId));
              const fill = Math.max(0, Math.min(1, stack.amount / size));
              const full = stack.amount >= size;
              const color = storageStackColor(stack.itemId);
              return (
                <Tooltip
                  key={`${stack.itemId}-${index}`}
                  title={`${itemName(stack.itemId)} · ${formatNumber(stack.amount)} / ${formatNumber(size)}`}
                >
                  <Box
                    role="img"
                    aria-label={`${itemName(stack.itemId)}: ${formatNumber(stack.amount)} of ${formatNumber(size)}`}
                    sx={{
                      position: 'relative',
                      width: 28,
                      height: 28,
                      overflow: 'hidden',
                      borderRadius: '3px',
                      border: '1px solid',
                      borderColor: color.color,
                      bgcolor: colors.surface,
                      outline: full ? `2px solid ${color.bright}` : 'none',
                      outlineOffset: full ? '1px' : 0,
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: `${fill * 100}%`,
                        bgcolor: color.color,
                        opacity: 0.72,
                      }}
                    />
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 0.75 }}>
            {legend.map((stack) => {
              const color = storageStackColor(stack.itemId);
              return (
                <Box
                  key={stack.itemId}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '2px',
                      bgcolor: color.color,
                    }}
                  />
                  <Typography variant="caption" className="planner-muted">
                    {itemName(stack.itemId)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mb: 1.5 }}>
            {[...totals.entries()].map(([itemId, total]) => (
              <Box
                key={itemId}
                sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}
              >
                <Typography variant="caption" className="planner-muted">
                  {itemName(itemId)}
                </Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {formatNumber(total)}
                </Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </>
  );
};
