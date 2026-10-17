import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'backend/package.json'));
require('dotenv').config({path:path.join(root,'backend/.env')});
const {hashPassword}=require(path.join(root,'backend/src/lib/security.js'));
const {DATABASE_URL}=require(path.join(root,'backend/src/config/env.js'));
let muted=false;const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
const rl=readline.createInterface({input:process.stdin,output,terminal:process.stdin.isTTY});
let pool,client;
async function secret(label){process.stdout.write(label);muted=true;try{return await rl.question('');}finally{muted=false;process.stdout.write('\n');}}
try{
 if(!DATABASE_URL)throw Error('Configure DATABASE_URL privately in backend/.env first.');
 const fullName=(await rl.question('Manager full name: ')).trim();
 const username=(await rl.question('Manager login username: ')).trim();
 const password=await secret('Manager password (hidden): '),confirm=await secret('Confirm password (hidden): ');
 if(!fullName||!/^[A-Za-z0-9_.@-]{3,80}$/.test(username))throw Error('Enter a name and a valid username (3–80 characters).');
 if(password.length<10||password!==confirm)throw Error('Passwords must match and contain at least 10 characters.');
 pool=new (require('pg').Pool)({connectionString:DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:15000,statement_timeout:15000});
 client=await pool.connect();await client.query('BEGIN');
 await client.query("select pg_advisory_xact_lock(hashtext('cc827-first-manager'))");
 const existing=await client.query("select user_id from public.users where lower(coalesce(role,'')) in ('admin','manager') limit 1");
 if(existing.rows.length)throw Error('A manager/admin already exists. Use Admin Control; no account was changed.');
 const result=await client.query(`insert into public.users(user_id,username,full_name,role,designation,recruiter_code,password,is_active,status,created_at,updated_at)
   values('MGR-01',$1,$2,'manager','Manager','MGR-01',$3,'1','Active',$4,$4) returning user_id`,[username,fullName,hashPassword(password),new Date().toISOString()]);
 if(result.rows.length!==1)throw Error('Manager creation was not confirmed.');
 await client.query('COMMIT');console.log('Manager created. Use your chosen username and password to sign in.');
}catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(error.code?'Manager setup failed. Check database access/schema; no data was overwritten.':error.message);process.exitCode=1;}
finally{rl.close();client?.release();if(pool)await pool.end();}
