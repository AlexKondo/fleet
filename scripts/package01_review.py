#!/usr/bin/env python3
"""Read-only integration report. Refuses symlink escapes; never copies or executes SQL."""
import argparse,hashlib,json
from pathlib import Path
PROTECTED={
 'apps/web/app/carpool/FmShell.tsx','apps/web/app/carpool/fm-theme.css',
 'apps/web/app/carpool/CarpoolSearch.tsx','apps/web/app/settings/users/UserRow.tsx',
 'apps/web/app/settings/users/actions.ts','apps/web/app/settings/users/page.tsx',
 'apps/web/app/MobileNav.tsx','apps/web/app/trips/new/actions.ts',
 'apps/web/app/account/license/actions.ts','packages/supabase-client/src/database.types.ts',
}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
def review(incoming,current):
 manifest=json.loads((incoming/'docs/fleetmind-v3/SOURCE_MANIFEST.json').read_text());base=json.loads((incoming/'docs/fleetmind-v3/BASELINE_KONDO_SHA256.json').read_text())
 rows=[]
 for name,expected in sorted(manifest.items()):
  rel=Path(name)
  if rel.is_absolute() or '..' in rel.parts:raise ValueError('Unsafe path')
  source=(incoming/rel).resolve();target=(current/rel).resolve()
  if not source.is_relative_to(incoming) or not target.is_relative_to(current):raise ValueError('Path escapes root')
  if digest(source)!=expected:raise ValueError('Integrity mismatch: '+name)
  actual=digest(target)
  status='equal' if actual==expected else 'keep_kondo' if expected==base.get(name) else 'candidate' if actual==base.get(name) else 'manual_merge'
  if actual!=expected and (name in PROTECTED or name.startswith('apps/web/lib/i18n/') or name.startswith('apps/web/app/account/license/')):status='manual_merge_preserve_kondo'
  rows.append({'path':name,'status':status,'base_sha256':base.get(name),'incoming_sha256':expected,'current_sha256':actual})
 required=['supabase/migrations/0074_license_expiration_source.sql','supabase/migrations/0075_ai_license_lock.sql']
 return {'mode':'read_only','not_homologated':True,'kondo_migrations':[{'path':n,'present':(current/n).is_file(),'sha256':digest(current/n)} for n in required], 'files':rows,
 'blocking_notes':['Never overwrite the current checkout with this snapshot.','Reconcile the incomplete ledger and schema in an isolated clone.','Merge and review license antifraud RPCs/types/source reader before integration.','No SQL, deployment or merge is performed by this script.']}
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('current',type=Path);p.add_argument('--incoming',type=Path,default=Path(__file__).resolve().parents[1]);a=p.parse_args()
 if not (a.current/'package.json').is_file():p.error('Expected checkout containing package.json')
 print(json.dumps(review(a.incoming.resolve(),a.current.resolve()),indent=2,ensure_ascii=False))
if __name__=='__main__':main()
