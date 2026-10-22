// Read-only deployment check. Run with the effective deployment environment, not a guessed .env.
const value=process.env.FM_ENABLE_AUTO_RESERVATION_RELEASE?.trim().toLowerCase();
if(value!==undefined && value!=='' && value!=='true'){
 console.error('NO-GO: automatic reservation release must remain active. Review the effective deployment configuration.');
 process.exitCode=1;
}else{
 console.log('Server policy: active (including absent variable). Database check is still required: run docs/consolidado_final/check-auto-release-policy.sql read-only.');
}
