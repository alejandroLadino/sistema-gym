-- Recomendaciones del asesor de Supabase:
-- 1) Las funciones auxiliares de RLS (SECURITY DEFINER) no deben quedar expuestas
--    como RPC en /rest/v1. Se mueven a un esquema privado que la API no publica.
--    Las políticas guardan la referencia por OID, así que siguen funcionando.
-- 2) Índices que cubren las claves foráneas compuestas (borrados en cascada).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.current_user_can_train() set schema private;
alter function public.current_user_is_admin() set schema private;

revoke execute on function private.current_user_can_train() from public, anon;
revoke execute on function private.current_user_is_admin() from public, anon;
grant execute on function private.current_user_can_train() to authenticated;
grant execute on function private.current_user_is_admin() to authenticated;

-- save_workout_session llamaba a la función por nombre: se actualiza la referencia.
create or replace function public.save_workout_session(p_session jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_date date;
  v_notes text;
  v_saved_id uuid;
  v_updated_at timestamptz;
  v_ex jsonb;
  v_ex_pos bigint;
  v_set jsonb;
  v_set_pos bigint;
  v_se_id uuid;
  v_reps integer;
  v_weight numeric;
begin
  if v_uid is null or not private.current_user_can_train() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if jsonb_typeof(p_session) <> 'object'
     or jsonb_typeof(p_session -> 'exercises') is distinct from 'array' then
    raise exception 'Formato de sesión inválido' using errcode = '22023';
  end if;

  v_id := (p_session ->> 'id')::uuid;
  v_date := (p_session ->> 'session_date')::date;
  v_notes := nullif(btrim(coalesce(p_session ->> 'notes', '')), '');

  if v_id is null or v_date is null then
    raise exception 'Falta el id o la fecha de la sesión' using errcode = '22023';
  end if;

  insert into public.workout_sessions as ws (id, user_id, session_date, notes)
  values (v_id, v_uid, v_date, v_notes)
  on conflict (id) do update
    set session_date = excluded.session_date,
        notes = excluded.notes,
        updated_at = now()
    where ws.user_id = v_uid
  returning ws.id, ws.updated_at into v_saved_id, v_updated_at;

  if v_saved_id is null then
    raise exception 'Sesión no encontrada' using errcode = '42501';
  end if;

  delete from public.session_exercises where session_id = v_id;

  for v_ex, v_ex_pos in
    select e.value, e.ordinality
    from jsonb_array_elements(p_session -> 'exercises') with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_ex -> 'sets') is distinct from 'array' then
      raise exception 'Formato de series inválido' using errcode = '22023';
    end if;

    insert into public.session_exercises (session_id, user_id, exercise_id, position)
    values (v_id, v_uid, (v_ex ->> 'exercise_id')::uuid, v_ex_pos - 1)
    returning id into v_se_id;

    for v_set, v_set_pos in
      select s.value, s.ordinality
      from jsonb_array_elements(v_ex -> 'sets') with ordinality as s(value, ordinality)
    loop
      v_reps := (v_set ->> 'reps')::integer;
      v_weight := nullif(v_set ->> 'weight_kg', '')::numeric;

      if v_weight is not null and v_weight <> round(v_weight, 2) then
        raise exception 'El peso admite como máximo dos decimales' using errcode = '22023';
      end if;

      insert into public.exercise_sets (session_exercise_id, user_id, position, reps, weight_kg)
      values (v_se_id, v_uid, v_set_pos - 1, v_reps, v_weight);
    end loop;
  end loop;

  return jsonb_build_object('id', v_saved_id, 'updated_at', v_updated_at);
end;
$$;

revoke execute on function public.save_workout_session(jsonb) from public, anon;
grant execute on function public.save_workout_session(jsonb) to authenticated;

create index if not exists session_exercises_session_user_idx on public.session_exercises (session_id, user_id);
create index if not exists session_exercises_exercise_user_idx on public.session_exercises (exercise_id, user_id);
create index if not exists exercise_sets_session_exercise_user_idx on public.exercise_sets (session_exercise_id, user_id);
