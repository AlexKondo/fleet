import {it,expect} from 'vitest';
import {canDrive,type OwnLicense} from './ownLicense';
const valid:OwnLicense={number:'123',category:'B',expiration:'2026-10-20',driverAuthorized:true};
it('requires number, regular calendar validity and authorization; failed lookup denies driving',()=>{
 const now=new Date('2026-10-20T15:00:00Z');expect(canDrive(valid,now)).toBe(true);
 for(const row of [null,{...valid,number:null},{...valid,expiration:null},{...valid,expiration:'invalid'},{...valid,expiration:'2026-02-30'},{...valid,driverAuthorized:false},{...valid,expiration:'2026-10-19'}])expect(canDrive(row,now)).toBe(false);
});
it('honors expiration through the last Brasília day, including UTC midnight',()=>{
 expect(canDrive(valid,new Date('2026-10-21T02:59:59Z'))).toBe(true);
 expect(canDrive(valid,new Date('2026-10-21T03:00:00Z'))).toBe(false);
});
