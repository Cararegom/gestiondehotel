-- Índices de soporte para relaciones de auditoría de la fase 5.
CREATE INDEX IF NOT EXISTS financial_budgets_created_by_idx ON public.financial_budgets(created_by);
CREATE INDEX IF NOT EXISTS financial_budgets_updated_by_idx ON public.financial_budgets(updated_by);
CREATE INDEX IF NOT EXISTS financial_periods_closed_by_idx ON public.financial_periods(closed_by);
CREATE INDEX IF NOT EXISTS financial_periods_reopened_by_idx ON public.financial_periods(reopened_by);
