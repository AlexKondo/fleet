// READ ONLY: prints a review plan. Never connects to a database, executes SQL or deploys.
import {readdirSync} from 'node:fs';
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url));
const names=numbers=>numbers.map(n=>{const matches=files.filter(f=>f.startsWith(String(n).padStart(4,'0')+'_'));if(matches.length!==1)throw new Error(`Migration number ${n} is missing or ambiguous`);return matches[0]});
console.log(JSON.stringify({mode:'read_only_not_authorization',prerequisite:'Reconcile the actual schema and ledger through 0209; do not reapply old migrations.',expand:names([210,211,212,213,215,217,218,219,220,221,222,225]),app:'Deploy verified, path-bound writers and audited edit/assignment commands only after authorization; prove one real upload.',contract:names([214,216,223,224,226,227]),warning:'Do not end the database window after 0213 without 0217. This plan executes nothing.'},null,2));
