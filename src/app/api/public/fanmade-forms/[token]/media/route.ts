import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@/utils/supabase/server';
import {apiFailure,apiSuccess,withApiErrorHandling} from '@/lib/api/server-auth';
import {fanmadeMediaUrl} from '@/lib/fanmade/media';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}){return withApiErrorHandling('GET fanmade media',async()=>{
 const token=z.string().uuid().safeParse((await params).token);const input=z.object({productId:z.string().uuid(),kind:z.enum(['image','video'])}).safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!token.success||!input.success)return apiFailure('媒體查詢格式錯誤',400);
 const {data,error}=await ((await createClient()) as SupabaseClient).rpc('get_fanmade_media',{p_token:token.data,p_product_id:input.data.productId,p_kind:input.data.kind});
 if(error)return apiFailure('媒體暫時無法讀取',503);if(!data)return apiFailure('影片尚未完成處理，或商品已停止訂購',404);
 const url=fanmadeMediaUrl(data.bucket,data.path);return url?apiSuccess({url}):apiFailure('媒體不存在',404);
});}
