"""Assemble 0215 and its rollback from the pg_get_functiondef dumps (before_defs) and the edited copies (work)."""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.abspath(os.path.join(here, "..", "..", "..", ".."))
names = ["fm_release_damage_hold", "complete_workflow_task", "cancel_workflow_task", "cancel_reservation",
         "fm_release_expired_reservations", "fm_key_command", "record_pickup"]

def body(folder, n):
    s = open(os.path.join(here, folder, n + ".sql"), encoding="utf-8").read().replace("\r\n", "\n").rstrip("\n")
    assert s.endswith("$function$"), n
    return f"-- {n}\n{s};\n\n"

def rd(p):
    return open(os.path.join(here, p), encoding="utf-8").read().replace("\r\n", "\n")

mig = rd("hdr_0215.sql") + "".join(body("work", n) for n in names) + rd("ftr_0215.sql")
rb = ("-- Rollback of 0215: restores the bodies captured with pg_get_functiondef BEFORE 0215 (database at 0214) and drops the helpers.\n"
      "-- ACL of the restored functions is untouched by create or replace.\n\n"
      + "".join(body("before_defs", n) for n in names)
      + "drop function if exists public.fm_vehicle_unsafe_status(uuid, uuid);\n"
      + "drop function if exists public.fm_vehicle_unsafe_reason(uuid, uuid);\n")
for path, text in [(os.path.join(repo, "supabase", "migrations", "0215_vehicle_safe_return_check.sql"), mig),
                   (os.path.join(repo, "supabase", "migrations", "rollback", "0215_rollback.sql"), rb)]:
    open(path, "w", encoding="utf-8", newline="\n").write(text)
    print("wrote", path, len(text))
