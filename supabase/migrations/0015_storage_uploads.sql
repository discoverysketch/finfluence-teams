-- Private 'uploads' bucket for card-generator PDFs (Vercel caps request bodies
-- at ~4.5MB, so files go client -> Storage, and the server fetches by path).
-- Bucket itself is created by script/service-role; these policies let a signed-in
-- user write/read/delete ONLY under their own uid/ folder. The generator route
-- reads via service role and deletes after use.
insert into storage.buckets (id, name, file_size_limit)
values ('uploads', 'uploads', 27262976)
on conflict (id) do nothing;

create policy "uploads_own_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads_own_select" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
