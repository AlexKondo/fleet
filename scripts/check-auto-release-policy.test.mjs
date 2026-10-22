import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
for(const [value,status] of [[undefined,0],['true',0],['false',1],['tru',1]]){
 test(`deployment guard ${value}`,()=>{const env={...process.env};delete env.FM_ENABLE_AUTO_RESERVATION_RELEASE;if(value!==undefined)env.FM_ENABLE_AUTO_RESERVATION_RELEASE=value;const r=spawnSync(process.execPath,['scripts/check-auto-release-policy.mjs'],{env});assert.equal(r.status,status)});
}
