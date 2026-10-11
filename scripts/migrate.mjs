import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function migrationFiles(){return readdirSync(resolve(ROOT,'db/migrations')).filter(x=>/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(x)).sort();}
export async function migrate({connectionString=process.env.DATABASE_URL,client}={}){
  if(!client&&!connectionString)throw new Error('DATABASE_URL is required');
  const db=client||new pg.Client({connectionString});
  const owned=!client;if(owned)await db.connect();
  let locked=false;
  try{
    await db.query('SELECT pg_advisory_lock($1)',[20114452]);locked=true;
    await db.query("CREATE TABLE IF NOT EXISTS public.schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())");
    const completed=[];
    for(const filename of migrationFiles()){
      const sql=readFileSync(resolve(ROOT,'db/migrations',filename),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const prior=await db.query('SELECT checksum FROM public.schema_migrations WHERE filename=$1',[filename]);
      if(prior.rows.length){if(prior.rows[0].checksum!==checksum)throw new Error('Applied migration changed: '+filename);completed.push({filename,status:'unchanged'});continue;}
      await db.query('BEGIN');
      try{await db.query(sql);await db.query('INSERT INTO public.schema_migrations(filename,checksum) VALUES ($1,$2)',[filename,checksum]);await db.query('COMMIT');completed.push({filename,status:'applied'});}
      catch(error){await db.query('ROLLBACK');throw error;}
    }
    return completed;
  }finally{if(locked)await db.query('SELECT pg_advisory_unlock($1)',[20114452]).catch(()=>{});if(owned)await db.end();}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))migrate().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error('Migration failed:',e.message);process.exitCode=1;});
