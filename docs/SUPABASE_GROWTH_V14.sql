-- Growth suite tables for manager-only client pipeline, revenue hub, and leadership performance
create table if not exists client_pipeline (
  lead_id text primary key,
  client_name text,
  contact_person text,
  contact_phone text,
  city text,
  industry text,
  status text,
  owner_username text,
  priority text,
  openings_count text,
  last_follow_up_at text,
  next_follow_up_at text,
  notes text,
  created_at text,
  updated_at text
);

create table if not exists client_requirements (
  req_id text primary key,
  lead_id text,
  jd_title text,
  city text,
  openings text,
  target_ctc text,
  status text,
  assigned_tl text,
  assigned_manager text,
  fill_target_date text,
  created_at text
);

create table if not exists revenue_entries (
  rev_id text primary key,
  client_name text,
  candidate_id text,
  jd_id text,
  recruiter_code text,
  amount_billed text,
  amount_collected text,
  invoice_status text,
  billing_month text,
  joined_at text,
  expected_payout_date text,
  source_channel text,
  created_at text
);

create index if not exists idx_client_pipeline_status on client_pipeline(status);
create index if not exists idx_client_pipeline_owner on client_pipeline(owner_username);
create index if not exists idx_revenue_entries_month on revenue_entries(billing_month);
create index if not exists idx_revenue_entries_invoice_status on revenue_entries(invoice_status);
create index if not exists idx_revenue_entries_recruiter_code on revenue_entries(recruiter_code);

insert into client_pipeline (lead_id,client_name,contact_person,contact_phone,city,industry,status,owner_username,priority,openings_count,last_follow_up_at,next_follow_up_at,notes,created_at,updated_at)
values
('L001','Blinkit Hiring Desk','Rohit Sharma','9812345678','Gurgaon','E-commerce','Proposal Sent','aaryansh.manager','High','18',now()::text,(now() + interval '1 day')::text,'Blended customer support ramp expected this week.',(now() - interval '12 days')::text,now()::text),
('L002','Teleperformance North','Megha Jain','9876501234','Noida','BPO','Negotiation','aaryansh.manager','Hot','32',now()::text,(now() + interval '18 hours')::text,'Awaiting revised commercial approval.',(now() - interval '9 days')::text,now()::text),
('L003','Airtel Process Hub','Ankita Singh','9898989898','Noida','Telecom','Active Hiring','aaryansh.manager','Critical','24',now()::text,(now() + interval '5 hours')::text,'Daily submission commitment in place.',(now() - interval '21 days')::text,now()::text)
on conflict (lead_id) do nothing;

insert into client_requirements (req_id,lead_id,jd_title,city,openings,target_ctc,status,assigned_tl,assigned_manager,fill_target_date,created_at)
values
('R001','L001','Customer Support Executive','Gurgaon','12','26000','Open','sakshi.tl','aaryansh.manager',(current_date + 5)::text,now()::text),
('R002','L001','Chat Support Associate','Gurgaon','6','24000','Sourcing','anjali.tl','aaryansh.manager',(current_date + 7)::text,now()::text),
('R003','L002','Claims Process Executive','Noida','15','31000','Interviewing','sakshi.tl','aaryansh.manager',(current_date + 8)::text,now()::text),
('R004','L003','Blended Process Associate','Noida','24','28000','Active','anjali.tl','aaryansh.manager',(current_date + 3)::text,now()::text)
on conflict (req_id) do nothing;

insert into revenue_entries (rev_id,client_name,candidate_id,jd_id,recruiter_code,amount_billed,amount_collected,invoice_status,billing_month,joined_at,expected_payout_date,source_channel,created_at)
values
('REV001','Airtel Process Hub','C001','J001','RC-101','55000','55000','Collected',to_char(current_date,'YYYY-MM'),(current_date - 6)::text,(current_date + 24)::text,'Database',now()::text),
('REV002','Blinkit Hiring Desk','C002','J002','RC-102','48000','20000','Partially Collected',to_char(current_date,'YYYY-MM'),(current_date - 4)::text,(current_date + 26)::text,'Indeed',now()::text),
('REV003','Teleperformance North','C003','J003','RC-103','62000','0','Invoice Raised',to_char(current_date,'YYYY-MM'),(current_date - 2)::text,(current_date + 28)::text,'Naukri',now()::text),
('REV004','Airtel Process Hub','C004','J004','RC-101','53000','0','Offer Accepted',to_char(current_date,'YYYY-MM'),(current_date + 5)::text,(current_date + 35)::text,'Reference',now()::text)
on conflict (rev_id) do nothing;
