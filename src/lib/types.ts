export type Role = "admin" | "user";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
};

export type Exercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  notes: string | null;
  archived_at: string | null;
};

export type SetValue = { reps: number; weight_kg: number | null };

export type SessionData = {
  id: string;
  session_date: string;
  notes: string | null;
  updated_at: string;
  exercises: {
    exercise_id: string;
    name: string;
    muscle_group: string | null;
    archived: boolean;
    sets: SetValue[];
  }[];
};

export type PreviousSets = { session_id: string; session_date: string; sets: SetValue[] };

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };
