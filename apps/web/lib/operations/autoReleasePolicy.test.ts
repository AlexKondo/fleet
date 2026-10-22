import {afterEach,expect,it,vi} from 'vitest';
import {automaticReleaseEnabled} from './autoReleasePolicy';
afterEach(()=>vi.unstubAllEnvs());
it.each([undefined,'','true',' TRUE '])('approved active policy: %s',value=>{vi.stubEnv('FM_ENABLE_AUTO_RESERVATION_RELEASE',value);expect(automaticReleaseEnabled()).toBe(true)});
it('explicit emergency suspension',()=>{vi.stubEnv('FM_ENABLE_AUTO_RESERVATION_RELEASE','false');expect(automaticReleaseEnabled()).toBe(false)});
it('rejects malformed configuration',()=>{vi.stubEnv('FM_ENABLE_AUTO_RESERVATION_RELEASE','tru');expect(()=>automaticReleaseEnabled()).toThrow('INVALID_AUTO_RESERVATION_RELEASE_CONFIGURATION')});
