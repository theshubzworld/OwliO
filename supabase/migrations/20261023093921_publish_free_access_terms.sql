-- Final free-access agreement for Owlio 1.0.16. Preserve draft history.
-- No account is accepted automatically; users must explicitly accept in the app.
update owlio_private.legal_policies set active=false where active;
insert into owlio_private.legal_policies(terms_version,privacy_version,document_hash,active)
values ('2026-10-23','2026-10-23','6f58703940881e9deffe3aea476a03e85d58108aefc00cc1cc395c0ebb5c5dac',true);
