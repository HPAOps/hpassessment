-- =============================================================================
-- HPA -- Text-based tests support (English 3, etc.)
-- =============================================================================
-- Adds a 'format' flag to tests, a passages table, and text/choice columns
-- to questions. Existing image-based tests keep working untouched
-- (format defaults to 'image').
--
-- Idempotent.
-- =============================================================================

-- 1) tests.format -----------------------------------------------------------
alter table public.tests
  add column if not exists format text not null default 'image'
    check (format in ('image','text'));

-- 2) test_passages ----------------------------------------------------------
create table if not exists public.test_passages (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  title text,
  body text not null,
  display_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists test_passages_test_idx on public.test_passages (test_id, display_order);

alter table public.test_passages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='test_passages' and policyname='test_passages_staff_read') then
    create policy test_passages_staff_read on public.test_passages
      for select to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid()
                       and role in ('super_admin','district_admin','campus_admin','teacher')));
  end if;
end $$;

-- 3) questions: text + choices + passage link ------------------------------
alter table public.questions
  add column if not exists question_text text,
  add column if not exists choice_a text,
  add column if not exists choice_b text,
  add column if not exists choice_c text,
  add column if not exists choice_d text,
  add column if not exists passage_id uuid references public.test_passages(id) on delete set null;

-- 4) get_student_attempt -- now returns passage + text + choices -----------
create or replace function public.get_student_attempt(
  p_attempt_id uuid, p_student_db_id uuid, p_session_secret uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_test public.tests%rowtype;
  v_questions jsonb;
  v_passages jsonb;
  v_responses jsonb;
  v_is_staff boolean;
begin
  select * into v_attempt from public.test_attempts
   where id = p_attempt_id and student_id = p_student_db_id;
  if not found then raise exception 'Attempt not found.'; end if;

  v_is_staff := coalesce(public.app_role()::text, '') in
    ('super_admin','district_admin','campus_admin','teacher');

  if not v_is_staff then
    if p_session_secret is null
       or v_attempt.session_secret is null
       or v_attempt.session_secret is distinct from p_session_secret then
      raise exception 'Invalid or expired session' using errcode = '42501';
    end if;
  end if;

  select * into v_test from public.tests where id = v_attempt.test_id;

  -- Questions include image_url (for image tests) AND text/choices/passage_id
  -- (for text tests). Frontend picks which to render based on test.format.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'question_number', q.question_number,
    'image_url', q.image_url,
    'question_text', q.question_text,
    'choice_a', q.choice_a,
    'choice_b', q.choice_b,
    'choice_c', q.choice_c,
    'choice_d', q.choice_d,
    'passage_id', q.passage_id,
    'display_order', taq.display_order
  ) order by taq.display_order), '[]'::jsonb)
  into v_questions
  from public.test_attempt_questions taq
  join public.questions q on q.id = taq.question_id
  where taq.attempt_id = p_attempt_id;

  -- Passages for this test (text-mode only -- empty otherwise)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'body', p.body, 'display_order', p.display_order
  ) order by p.display_order), '[]'::jsonb)
  into v_passages
  from public.test_passages p
  where p.test_id = v_attempt.test_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question_id', sr.question_id,
    'selected_answer', sr.selected_answer
  )), '[]'::jsonb)
  into v_responses
  from public.student_responses sr
  where sr.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'attempt', to_jsonb(v_attempt) - 'session_secret',
    'test', jsonb_build_object(
      'id', v_test.id, 'name', v_test.name,
      'test_type', v_test.test_type, 'format', v_test.format
    ),
    'questions', v_questions,
    'passages', v_passages,
    'responses', v_responses
  );
end $$;

revoke all on function public.get_student_attempt(uuid, uuid, uuid) from public;
grant execute on function public.get_student_attempt(uuid, uuid, uuid) to anon, authenticated;

-- 5) admin_import_text_test -- bulk insert passages + questions ------------
-- p_passages: jsonb array of {ordinal:int, title:text|null, body:text}
-- p_questions: jsonb array of {qn:int, question_text:text,
--                              choice_a/b/c/d:text, correct:char, passage_ordinal:int|null}
create or replace function public.admin_import_text_test(
  p_test_id uuid,
  p_passages jsonb,
  p_questions jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_passage_map jsonb := '{}'::jsonb;
  v_p jsonb;
  v_q jsonb;
  v_new_id uuid;
  v_q_count int := 0;
  v_p_count int := 0;
  v_passage_id uuid;
begin
  -- Must be a staff role that can manage tests
  v_role := coalesce(public.app_role()::text, '');
  if v_role not in ('super_admin','district_admin') then
    raise exception 'Not authorized to import tests' using errcode = '42501';
  end if;

  -- Mark the test as text-format
  update public.tests set format = 'text' where id = p_test_id;

  -- Wipe any existing text content on this test (idempotent re-import)
  delete from public.questions where test_id = p_test_id;
  delete from public.test_passages where test_id = p_test_id;

  -- Insert passages, remembering ordinal -> id
  for v_p in select * from jsonb_array_elements(p_passages)
  loop
    insert into public.test_passages (test_id, title, body, display_order)
    values (p_test_id, v_p->>'title', v_p->>'body',
            coalesce((v_p->>'ordinal')::int, v_p_count + 1))
    returning id into v_new_id;
    v_passage_map := v_passage_map || jsonb_build_object(coalesce(v_p->>'ordinal', (v_p_count+1)::text), v_new_id::text);
    v_p_count := v_p_count + 1;
  end loop;

  -- Insert questions
  for v_q in select * from jsonb_array_elements(p_questions)
  loop
    v_passage_id := null;
    if v_q ? 'passage_ordinal' and v_q->>'passage_ordinal' is not null then
      v_passage_id := (v_passage_map->>(v_q->>'passage_ordinal'))::uuid;
    end if;
    insert into public.questions (
      id, test_id, question_number, correct_answer, image_url,
      question_text, choice_a, choice_b, choice_c, choice_d,
      passage_id, is_active
    ) values (
      gen_random_uuid(), p_test_id,
      (v_q->>'qn')::int,
      (v_q->>'correct')::answer_letter,
      null,
      v_q->>'question_text',
      v_q->>'choice_a', v_q->>'choice_b', v_q->>'choice_c', v_q->>'choice_d',
      v_passage_id, true
    );
    v_q_count := v_q_count + 1;
  end loop;

  -- Update question_count on the tests row to match
  update public.tests set question_count = v_q_count where id = p_test_id;

  return jsonb_build_object(
    'test_id', p_test_id,
    'passage_count', v_p_count,
    'question_count', v_q_count
  );
end $$;

revoke all on function public.admin_import_text_test(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_import_text_test(uuid, jsonb, jsonb) to authenticated;

select 'Text-test schema ready' as status;
