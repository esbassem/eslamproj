begin;

drop function if exists public.unapply_financial_advance(uuid,uuid,text);

comment on function public.unapply_financial_advance(uuid,uuid,text,text,date) is
  'Canonical idempotent advance unapplication. Removes the two application reconciliations through a protected helper, posts a reversing reclassification move, closes original/reversal reclassification open items, and preserves the immutable application history.';

commit;
