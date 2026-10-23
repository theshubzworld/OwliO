# Owlio Privacy Notice

Version: 2026-10-23

Document bundle SHA-256: 6f58703940881e9deffe3aea476a03e85d58108aefc00cc1cc395c0ebb5c5dac

## Who handles the data

The Owlio project maintainers operate the official app’s account and usage services. Contact: shubzveo@gmail.com.

## Account and agreement records

Supabase handles sign-in. Account records include your account ID, email address, sign-in provider and authentication information. Owlio separately stores which Terms and Privacy Notice versions you accepted, a fingerprint of those documents, the server acceptance timestamp, app version, and any account suspension record. These records identify your account; they are separate from usage-event payloads. Session credentials are encrypted on your computer using Windows protection and are cleared by signing out.

## Required usage events and purpose

After you sign in and explicitly accept, the official app reports basic usage to measure adoption, reliability and feature performance. Events include a random installation ID; activity counts; app and Windows versions; provider, model and language categories; stage timings; audio duration and word counts; and success or failure counts. There is no session replay or automatic screen capture. The payload does not contain your account email or ID, audio, dictated or selected text, commands, API keys, or window titles. Account login and agreement records remain identifiable. No analytics events are sent before acceptance; signing out stops collection and clears unsent events.

## Network metadata and service providers

Supabase hosts account records, agreement records and usage events. Network requests necessarily expose connection metadata such as IP addresses to infrastructure providers. The collector uses a daily one-way network bucket for abuse limits and does not store raw IP addresses in Owlio usage tables. Provider infrastructure logs may retain their own request metadata. A separately configured analytics processor, such as PostHog, may receive the same limited usage events; account email and content are not forwarded in those events.

## Local information and optional cloud AI

History, saved audio when enabled, dictionary entries, settings, writing rules and provider keys stay on this computer unless the selected feature sends relevant information to a provider. Groq speech receives audio when selected. Gemini romanization and cleanup receive the relevant text. Cloud rewrite and meeting-summary features receive selected text, commands or transcripts as needed. Local models process locally. Correction learning can send spelling candidates to the configured writing provider. Those providers apply their own privacy policies; required basic analytics does not authorize additional content collection.

## Retention and stopping use

Owlio usage events expire after 90 days; inactive installation records are removed after 90 days. Unsent events are bounded to 200 entries and expire after seven days. Abuse-rate buckets expire after two days. Account and agreement records remain while the account is active, so Owlio can verify access and the accepted versions. Deleting an account removes its agreement records. Suspension audit entries expire after 90 days. To stop reporting, sign out and stop using the official app; there is no separate analytics opt-out while using this free service. Local history can be managed in the app and is not deleted merely by signing out.

## Requests and updates

Contact shubzveo@gmail.com from your account email to request access to, correction of, or deletion of your account data, or to raise a privacy concern. The maintainers may need to verify control of the account. Applicable privacy rights remain available. Updated document versions will be shown for renewed acceptance.
