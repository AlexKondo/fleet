/** Approved policy: active by default. false is emergency suspension only. */
export function automaticReleaseEnabled():boolean{
 const value=process.env.FM_ENABLE_AUTO_RESERVATION_RELEASE?.trim().toLowerCase();
 if(value===undefined||value===''||value==='true')return true;
 if(value==='false')return false;
 throw new Error('INVALID_AUTO_RESERVATION_RELEASE_CONFIGURATION');
}
