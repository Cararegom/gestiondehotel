-- M3: marca como revision manual notificaciones Gmail distintas que pueden
-- representar la misma transferencia. Conserva ambos eventos y nunca decide
-- por si sola que un pago es duplicado.

create index if not exists bank_payment_events_possible_duplicate_idx
  on public.bank_payment_events (
    hotel_id,
    (lower(btrim(coalesce(bank_name, '')))),
    amount_cop,
    (coalesce(transaction_occurred_at, email_received_at, created_at))
  )
  where provider = 'gmail'
    and coalesce(btrim(transaction_reference), '') = ''
    and status not in ('rejected', 'duplicated')
    and metadata ->> 'is_test' is distinct from 'true';

create or replace function app_private.bank_email_flag_possible_duplicate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_event_at timestamptz;
  v_bank_name text;
  v_sender_name text;
  v_candidate_ids uuid[];
  v_same_content boolean := false;
  v_same_sender boolean := false;
begin
  if new.provider is distinct from 'gmail'
     or new.status is distinct from 'detected'
     or coalesce(btrim(new.transaction_reference), '') <> ''
     or new.amount_cop is null
     or new.amount_cop <= 0
     or new.metadata ->> 'is_test' is not distinct from 'true' then
    return new;
  end if;

  v_event_at := coalesce(
    new.transaction_occurred_at,
    new.email_received_at,
    new.created_at,
    statement_timestamp()
  );
  v_bank_name := lower(btrim(coalesce(new.bank_name, '')));
  v_sender_name := regexp_replace(
    translate(lower(btrim(coalesce(new.sender_name, ''))), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+',
    '',
    'g'
  );

  if v_bank_name = ''
     or (
       v_sender_name = ''
       and coalesce(btrim(new.raw_content_hash), '') = ''
     ) then
    return new;
  end if;

  -- Serializa inserciones equivalentes para que dos webhooks concurrentes no
  -- consulten ambos una tabla todavia vacia antes de confirmar sus inserts.
  perform pg_advisory_xact_lock(hashtextextended(
    new.hotel_id::text || ':' || v_bank_name || ':' || new.amount_cop::text,
    0
  ));

  select
    array_agg(candidate.id order by candidate.event_at, candidate.id),
    bool_or(candidate.same_content),
    bool_or(candidate.same_sender)
    into v_candidate_ids, v_same_content, v_same_sender
  from (
    select
      event.id,
      coalesce(event.transaction_occurred_at, event.email_received_at, event.created_at) as event_at,
      (
        coalesce(btrim(new.raw_content_hash), '') <> ''
        and event.raw_content_hash = new.raw_content_hash
      ) as same_content,
      (
        v_sender_name <> ''
        and regexp_replace(
          translate(lower(btrim(coalesce(event.sender_name, ''))), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+',
          '',
          'g'
        ) = v_sender_name
      ) as same_sender
    from public.bank_payment_events event
    where event.hotel_id = new.hotel_id
      and event.provider = 'gmail'
      and lower(btrim(coalesce(event.bank_name, ''))) = v_bank_name
      and event.amount_cop = new.amount_cop
      and event.gmail_message_id is distinct from new.gmail_message_id
      and coalesce(btrim(event.transaction_reference), '') = ''
      and event.status not in ('rejected', 'duplicated')
      and event.metadata ->> 'is_test' is distinct from 'true'
      and coalesce(event.transaction_occurred_at, event.email_received_at, event.created_at)
          between v_event_at - interval '120 seconds'
              and v_event_at + interval '120 seconds'
      and (
        (
          coalesce(btrim(new.raw_content_hash), '') <> ''
          and event.raw_content_hash = new.raw_content_hash
        )
        or (
          v_sender_name <> ''
          and regexp_replace(
            translate(lower(btrim(coalesce(event.sender_name, ''))), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+',
            '',
            'g'
          ) = v_sender_name
        )
      )
    order by coalesce(event.transaction_occurred_at, event.email_received_at, event.created_at), event.id
    limit 5
  ) candidate;

  if coalesce(cardinality(v_candidate_ids), 0) = 0 then
    return new;
  end if;

  new.status := 'manual_review';
  new.review_reason := 'possible_duplicate_transfer';
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'possible_duplicate', true,
    'possible_duplicate_candidate_ids', to_jsonb(v_candidate_ids),
    'possible_duplicate_candidate_count', cardinality(v_candidate_ids),
    'possible_duplicate_window_seconds', 120,
    'possible_duplicate_same_content', coalesce(v_same_content, false),
    'possible_duplicate_same_sender', coalesce(v_same_sender, false),
    'possible_duplicate_detected_at', statement_timestamp()
  );

  return new;
end;
$function$;

revoke all on function app_private.bank_email_flag_possible_duplicate()
  from public, anon, authenticated;

drop trigger if exists bank_email_flag_possible_duplicate_trg
  on public.bank_payment_events;
create trigger bank_email_flag_possible_duplicate_trg
before insert on public.bank_payment_events
for each row
execute function app_private.bank_email_flag_possible_duplicate();
