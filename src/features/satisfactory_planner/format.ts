import { gameData } from './api/gameData';

export const formatNumber = (value: number, maximumFractionDigits = 2): string =>
  value.toLocaleString(undefined, { maximumFractionDigits });

export const formatMW = (value: number): string => `${formatNumber(value, 1)} MW`;

export const formatPercent = (value: number): string => `${formatNumber(value * 100, 1)}%`;

export const itemName = (itemId: string): string =>
  gameData.items[itemId]?.name ?? itemId;

export const itemUnit = (itemId: string): string => {
  const form = gameData.items[itemId]?.form;
  return form === 'liquid' || form === 'gas' ? 'm³/min' : 'items/min';
};

export const itemRateLabel = (itemId: string, rate: number): string =>
  `${formatNumber(rate)} ${itemUnit(itemId)}`;

export const shortDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

export const fileNameWithoutExtension = (name: string): string =>
  name.replace(/\.sav$/i, '');
