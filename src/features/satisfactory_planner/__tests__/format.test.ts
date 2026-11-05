import { describe, expect, it } from 'vitest';
import {
  fileNameWithoutExtension,
  formatMW,
  formatNumber,
  formatPercent,
  itemName,
  itemRateLabel,
  itemUnit,
  shortDate,
} from '../format';

describe('format helpers', () => {
  it('formats numbers, power and percentages', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57');
    expect(formatNumber(1.5, 0)).toBe('2');
    expect(formatMW(12.34)).toBe('12.3 MW');
    expect(formatPercent(0.1234)).toBe('12.3%');
  });

  it('resolves item names and units', () => {
    expect(itemName('Desc_IronPlate_C')).toBe('Iron Plate');
    expect(itemName('Desc_Missing_C')).toBe('Desc_Missing_C');
    expect(itemUnit('Desc_Water_C')).toBe('m³/min');
    expect(itemUnit('Desc_NitrogenGas_C')).toBe('m³/min');
    expect(itemUnit('Desc_IronPlate_C')).toBe('items/min');
    expect(itemUnit('Desc_Missing_C')).toBe('items/min');
    expect(itemRateLabel('Desc_IronPlate_C', 60)).toBe('60 items/min');
  });

  it('formats dates and file names', () => {
    expect(shortDate('2026-01-02T03:04:05.000Z')).not.toBe('2026-01-02T03:04:05.000Z');
    expect(shortDate('not a date')).toBe('not a date');
    expect(fileNameWithoutExtension('My Factory.sav')).toBe('My Factory');
    expect(fileNameWithoutExtension('My Factory.SAV')).toBe('My Factory');
  });
});
