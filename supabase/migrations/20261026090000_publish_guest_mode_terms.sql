-- Guest-mode agreement (2026-10-26): signing in is optional and reporting applies only to signed-in accounts.
-- Preserve earlier versions. No account is accepted automatically; signed-in users accept again in the app.
update owlio_private.legal_policies set active=false where active;
insert into owlio_private.legal_policies(terms_version,privacy_version,document_hash,active)
values ('2026-10-26','2026-10-26','b216830434bd11685d455e1e82b582621352f221e4ecf976cd72ac13c05e203e',true);
