-- A problem's statement may be a PDF instead of Markdown. The file lives with the problem's other
-- files (so the attachments policies already hide it until the problem is readable), and the
-- column only takes a PDF that was uploaded to this problem's own folder.
create or replace function private.challenges_check_statement_pdf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statement_pdf_path is null then
    return new;
  end if;
  if new.statement_pdf_path !~ ('^' || new.event_id::text || '/' || new.id::text || '/statement-[0-9a-f-]{36}\.pdf$')
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'attachments' and o.name = new.statement_pdf_path
        and o.metadata ->> 'mimetype' = 'application/pdf'
    )
  then
    raise exception 'Upload the statement PDF to this problem first.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.challenges_check_statement_pdf() from public, anon, authenticated;

drop trigger if exists challenges_problems_statement_pdf on public.challenges_problems;
create trigger challenges_problems_statement_pdf
  before insert or update of statement_pdf_path on public.challenges_problems
  for each row execute function private.challenges_check_statement_pdf();
