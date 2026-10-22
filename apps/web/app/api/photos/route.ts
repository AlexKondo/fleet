import {NextResponse,type NextRequest} from 'next/server';
import {revalidatePath} from 'next/cache';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
import {finishStoredPhoto} from '@/lib/domain/storedPhoto';
import {ALL_PHOTO_ANGLES,type PhotoAngle} from '@/lib/domain/checklist';
export const dynamic='force-dynamic';
async function readSmallBody(request: NextRequest): Promise<string> {
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>4096){await reader.cancel();throw new Error('BODY_TOO_LARGE');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:NextRequest):Promise<NextResponse>{
 if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'not_authorized'},{status:403});
 if(Number(request.headers.get('content-length')??0)>4096)return NextResponse.json({error:'invalid_request'},{status:413});
 let text:string;try{text=await readSmallBody(request)}catch(error){return NextResponse.json({error:'invalid_request'},{status:error instanceof Error&&error.message==='BODY_TOO_LARGE'?413:400});}
 let body;try{body=JSON.parse(text)}catch{return NextResponse.json({error:'invalid_request'},{status:400});}
 if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'invalid_request'},{status:400});
 const db=await createSupabaseServerClient();if(!await getCurrentUser(db))return NextResponse.json({error:'not_authenticated'},{status:401});
 try{
  if(body.phase==='finish'){
   if(typeof body.id!=='string'||!uuid.test(body.id))return NextResponse.json({error:'invalid_request'},{status:400});
   const result=await finishStoredPhoto(db,body.id);for(const path of ['/fleet','/trips','/gate','/account/photos'])revalidatePath(path);return NextResponse.json(result);
  }
  if(body.phase!=='begin'||!['inspection','vehicle'].includes(body.kind)||typeof body.target!=='string'||!uuid.test(body.target)||typeof body.sha!=='string'||!/^[0-9a-f]{64}$/.test(body.sha)||!Number.isInteger(body.size)||body.size<1||body.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(body.mime)||(body.kind==='inspection'?!ALL_PHOTO_ANGLES.includes(body.angle):body.angle!==null))return NextResponse.json({error:'invalid_request'},{status:400});
  const result=await db.rpc('fm_photo_begin',{p_kind:body.kind,p_target:body.target,p_angle:body.angle as PhotoAngle,p_sha256:body.sha,p_size:body.size,p_mime:body.mime});
  if(result.error)return NextResponse.json({error:'photo_not_authorized_or_conflict'},{status:403});
  return NextResponse.json(result.data);
 }catch{return NextResponse.json({error:'photo_pending'},{status:409});}
}
