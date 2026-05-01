-- Rename lists.share_token to lists.slug. "Token" implied bearer credential,
-- which doesn't fit a short, stable, public URL identifier. The new name
-- adopts standard web vocabulary (URL slug). Length 8 → 6 base62 chars
-- (~57 billion combinations); existing rows are rewritten to new 6-char
-- slugs in a PL/pgSQL block so the post-rename CHECK can be a clean = 6.
--
-- Pre-launch test data only; existing /r/<8-char> URLs do not need to
-- continue working. The UNIQUE constraint follows the column rename
-- automatically; only the length CHECK needs explicit drop/replace.

alter table lists drop constraint lists_share_token_check;

alter table lists rename column share_token to slug;

-- Rewrite every existing slug to a fresh 6-char base62 value. Inner loop
-- retries on the (effectively impossible) unique-violation. PL/pgSQL has
-- no built-in base62, so we sample one char at a time from the alphabet.
do $$
declare
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  r record;
  candidate text;
begin
  for r in select id from lists loop
    loop
      candidate := '';
      for i in 1..6 loop
        candidate := candidate || substr(alphabet, 1 + floor(random() * 62)::int, 1);
      end loop;
      begin
        update lists set slug = candidate where id = r.id;
        exit;
      exception when unique_violation then
        -- collision; retry with a fresh candidate
      end;
    end loop;
  end loop;
end $$;

alter table lists
  add constraint lists_slug_length
  check (char_length(slug) = 6);
