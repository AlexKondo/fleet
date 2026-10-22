'use client';
import {directPhotoUpload,fieldsWithoutPhotos} from '@/lib/domain/directPhotoUpload';
import type {FleetActionState} from './actions';
import {vehiclePhotoTypeUnsupported} from '@/lib/domain/vehiclePhotoLimit';
/** A created vehicle is never created again just because its independent photo upload failed. */
export async function createVehicleWithPhoto(previous:FleetActionState,data:FormData,save:(state:FleetActionState,fields:FormData)=>Promise<FleetActionState>,pendingMessage:string,typeMessage?:string):Promise<FleetActionState>{
 const photo=data.get('photo');
 // T2-D02: an unsupported format (HEIC...) is refused before anything is saved, with a format message.
 if(typeMessage&&photo instanceof File&&vehiclePhotoTypeUnsupported(photo))return {status:'error',error:typeMessage,vehicleId:previous.vehicleId};
 if(previous.vehicleId&&!(photo instanceof File&&photo.size))return previous;
 const result:FleetActionState=previous.vehicleId?{status:'success',vehicleId:previous.vehicleId}:await save(previous,fieldsWithoutPhotos(data));
 if(result.status==='success'&&photo instanceof File&&photo.size){
  if(!result.vehicleId)return {status:'error',error:pendingMessage};
  try{await directPhotoUpload('vehicle',result.vehicleId,null,photo)}catch{return {status:'error',error:pendingMessage,vehicleId:result.vehicleId};}
 }
 return result;
}
