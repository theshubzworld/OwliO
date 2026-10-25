# Owlio Privacy Notice

Version: 2026-10-26

Document bundle SHA-256: b216830434bd11685d455e1e82b582621352f221e4ecf976cd72ac13c05e203e

## Who handles the data

The Owlio project maintainers operate the official app’s optional account and usage services. Contact: shubzveo@gmail.com.

## Guest mode

Owlio works without an account. In guest mode, Owlio creates no account record and sends no usage events. The app connects to the internet only when you download speech runtimes or models (from GitHub, Python package and PyTorch servers, and Hugging Face) or choose a cloud provider, as described below. Those hosts receive normal connection metadata such as your IP address under their own policies.

## Account and agreement records

If you sign in, Supabase handles sign-in. Account records include your account ID, email address, sign-in provider and authentication information. Owlio separately stores which Terms and Privacy Notice versions you accepted, a fingerprint of those documents, the server acceptance timestamp, app version, and any account suspension record. These records identify your account; they are separate from usage-event payloads. Session credentials are encrypted on your computer using Windows protection and are cleared by signing out.

## Usage events for signed-in accounts and purpose

Only after you sign in and explicitly accept does the official app report basic usage, to measure adoption, reliability and feature performance. Events include a random installation ID; activity counts; app and Windows versions; provider, model and language categories; stage timings; audio duration and word counts; and success or failure counts. There is no session replay or automatic screen capture. The payload does not contain your account email or ID, audio, dictated or selected text, commands, API keys, or window titles. Account login and agreement records remain identifiable. No analytics events are sent in guest mode or before acceptance; signing out stops collection and clears unsent events.

## Network metadata and service providers

Supabase hosts account records, agreement records and usage events. Network requests necessarily expose connection metadata such as IP addresses to infrastructure providers. The collector uses a daily one-way network bucket for abuse limits and does not store raw IP addresses in Owlio usage tables. Provider infrastructure logs may retain their own request metadata. A separately configured analytics processor, such as PostHog, may receive the same limited usage events; account email and content are not forwarded in those events.

## Local information and optional cloud AI

History, saved audio when enabled, dictionary entries, settings, writing rules and provider keys stay on this computer unless the selected feature sends relevant information to a provider. Groq speech receives audio when selected. Gemini romanization and cleanup receive the relevant text. Cloud rewrite and meeting-summary features receive selected text, commands or transcripts as needed. Local models process locally. Correction learning can send spelling candidates to the configured writing provider. Those providers apply their own privacy policies; basic usage reporting does not authorize additional content collection.

## Retention and stopping use

Owlio usage events expire after 90 days; inactive installation records are removed after 90 days. Unsent events are bounded to 200 entries and expire after seven days. Abuse-rate buckets expire after two days. Account and agreement records remain while the account is active, so Owlio can verify access and the accepted versions. Deleting an account removes its agreement records. Suspension audit entries expire after 90 days. To stop reporting, sign out; the app keeps working in guest mode. Local history can be managed in the app and is not deleted merely by signing out.

## Requests and updates

Contact shubzveo@gmail.com from your account email to request access to, correction of, or deletion of your account data, or to raise a privacy concern. The maintainers may need to verify control of the account. Applicable privacy rights remain available. Signed-in accounts will be shown updated document versions for renewed acceptance.
