import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({upload:vi.fn()}));
vi.mock('@/lib/domain/directPhotoUpload',()=>({directPhotoUpload:m.upload,fieldsWithoutPhotos:(data:FormData)=>{const fields=new FormData();for(const [k,v] of data)if(!(v instanceof File))fields.append(k,v);return fields}}));
import {createVehicleWithPhoto} from './photoSubmission';
import type {FleetActionState} from './actions';
const initial:FleetActionState={status:'idle'};
function data(){const d=new FormData();d.set('plate','TEST001');d.set('photo',new File(['photo'],'photo.png',{type:'image/png'}));return d;}
beforeEach(()=>m.upload.mockReset().mockResolvedValue(undefined));
it('creates once with fields only and then uploads the photo to that identity',async()=>{const save=vi.fn(async (_state:FleetActionState,_fields:FormData)=>({status:'success' as const,vehicleId:'created'}));expect(await createVehicleWithPhoto(initial,data(),save,'pending')).toEqual({status:'success',vehicleId:'created'});expect(save.mock.calls[0]?.[1]?.get('photo')).toBeNull();expect(m.upload).toHaveBeenCalledWith('vehicle','created',null,expect.any(File))});
it('a failed photo retains the created identity and retry never duplicates the vehicle',async()=>{const save=vi.fn(async (_state:FleetActionState,_fields:FormData)=>({status:'success' as const,vehicleId:'created'}));m.upload.mockRejectedValueOnce(new Error('network'));const failed=await createVehicleWithPhoto(initial,data(),save,'pending');expect(failed).toEqual({status:'error',error:'pending',vehicleId:'created'});expect((await createVehicleWithPhoto(failed,data(),save,'pending')).status).toBe('success');expect(save).toHaveBeenCalledTimes(1)});
it('a missing photo on retry keeps the error instead of silently reporting success',async()=>{const previous:FleetActionState={status:'error',error:'pending',vehicleId:'created'};const save=vi.fn();expect(await createVehicleWithPhoto(previous,new FormData(),save,'pending')).toBe(previous);expect(save).not.toHaveBeenCalled();expect(m.upload).not.toHaveBeenCalled()});
