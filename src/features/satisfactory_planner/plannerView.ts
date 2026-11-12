import { createContext, useContext } from 'react';

export type PlannerView = 'planner' | 'info';

export interface PlannerViewContextValue {
  view: PlannerView;
  setView: (view: PlannerView) => void;
}

export const PlannerViewContext = createContext<PlannerViewContextValue>({
  view: 'planner',
  setView: () => undefined,
});

export const usePlannerView = (): PlannerViewContextValue =>
  useContext(PlannerViewContext);
