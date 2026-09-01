-- Allow the durable Caja reconciliation audit action introduced by
-- 20260901184238_bank_payment_allocation_caja_link.sql.
--
-- Without this value the final audit insert rejects the transaction and the
-- entire bank-to-Caja reconciliation is rolled back.

alter table public.bank_payment_audit_log
  drop constraint if exists bank_payment_audit_log_action_check;

alter table public.bank_payment_audit_log
  add constraint bank_payment_audit_log_action_check
  check (action = any (array[
    'payment_detected'::text,
    'auto_matched'::text,
    'manual_confirmed'::text,
    'relation_changed'::text,
    'payment_rejected'::text,
    'duplicate_detected'::text,
    'parse_error'::text,
    'gmail_watch_renewed'::text,
    'gmail_watch_renewal_failed'::text,
    'gmail_connected'::text,
    'gmail_connection_failed'::text,
    'gmail_disconnected'::text,
    'matching_ambiguous'::text,
    'no_match'::text,
    'marked_reviewed'::text,
    'expected_payment_created'::text,
    'expected_payment_cancelled'::text,
    'multiple_allocation_changed'::text,
    'manual_reconciliation_state_changed'::text,
    'cash_movement_linked'::text
  ]));
