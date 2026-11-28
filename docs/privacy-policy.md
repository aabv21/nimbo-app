<!-- Draft, not legal advice until a lawyer reviews it. `pnpm policy:check` lists the placeholders the owner fills before publishing. -->

# Nimbo privacy policy

English · [Español]({{POLICY_URL}}es/) · [Português]({{POLICY_URL}}pt/)

Version 2026-12-01 · Last updated 2026-12-01

<a id="summary"></a>
## In short

Nimbo is a migraine diary with an optional AI companion. It records your attacks, medications and daily check-ins, shows them back to you and describes patterns in them. Nimbo is not a medical device: it does not diagnose, treat or prevent any condition, and it does not replace a health professional.

This page explains what Nimbo collects, why, where it is kept, who processes it, how long it is kept and how you use your rights. In short:

- Your migraine records are health data. Nimbo stores them only with your specific consent.
- The AI companion is a second, separate choice. Without it, nothing goes to an AI service.
- Your data is never sold, never used for ads and never analyzed for anyone else. Nimbo has no ads, no analytics and no tracking.
- You can export your data or delete your account from the app at any time, or by email.

Questions go to [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

<a id="controller"></a>
## Who is responsible

The controller of your data is {{CONTROLLER_NAME}}, {{CONTROLLER_COUNTRY}}, who builds and runs Nimbo. Contact: [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

The data protection officer (in Brazil, the “encarregado”) is {{DPO_NAME}}, at the same address.

Nimbo is offered in {{LAUNCH_COUNTRIES}}. It is not offered in the European Economic Area, the United Kingdom or Switzerland.

Nimbo is for adults. You confirm that you are 18 or older before you create an account. Nimbo does not knowingly collect data about anyone under 18; if an account turns out to belong to a minor, it is deleted.

<a id="health-data-consent"></a>
## Your health data and your consent

> **Your migraine records are health data, a sensitive category of personal data.** That covers your attacks, your medications and doses, your check-ins (sleep, stress, water, caffeine, alcohol, meals, screen time and periods), your triggers and notes, the onboarding answers about your triggers and priorities, Nimbo’s notes about you and the signals computed from your records.
>
> **Nimbo stores them only with your specific consent**, which you give on the “Before you start” screen by ticking “I agree that Nimbo stores my migraine records, medications and check-ins, which are health data, to show them back to me and find patterns.” Nimbo uses them only to keep your diary, show it back to you, compute your patterns and signals, warn you about medication overuse and remind you of your preventive medication.
>
> **The AI companion is a second, separate consent**, on the “Nimbo’s AI and your health data” screen. Without it, none of your data goes to an AI service.
>
> **What saying no means.** Nimbo cannot keep a diary without storing it, so without the first consent there is no account. Without the second, Nimbo is still a complete tracker, without the Nimbo tab and dictation.
>
> **How to withdraw.** Turn off “Use Nimbo’s AI” in Profile to stop all AI processing at once. Deleting your account withdraws the first consent and deletes your data.

Your health data is never sold, never used for advertising or data mining and never shared to gain an economic advantage.

<a id="what-we-collect"></a>
## What Nimbo collects, and why

Nimbo collects only what each feature needs. For each kind of data, here is what it is, how it is collected, why and whether you must give it:

- **Your account.** Your email address and a password, which Supabase Auth stores only as a hash. If you sign in with Google, or with Apple on an iPhone, Nimbo receives the identity token that service issues for you, with your email address. Used to sign you in. Required.
- **Your settings.** Your language, time zone, appearance, reduced motion, the hours and the daily number of notifications, whether the lock screen shows details, and your onboarding answers (your priority, the triggers you already know and whether you track your period). Used to run the app in your language and time, and to time the signals. You choose each one.
- **Your approximate area, only if you allow it.** During setup Nimbo can read your location once, with the “while using the app” permission, and keeps it rounded to one decimal (a cell about 11 km across). It never keeps your exact position, and the app cannot request precise location on Android. Used only for the air pressure signal. Optional.
- **Your attacks.** When each started and ended, the intensity from 0 to 10, where it hurt, your symptoms and triggers, what you tried, what helped and what did not, your notes (up to 2,000 characters), whether you logged it by tapping, by voice or in the chat, and when you answered the day-after check. Typed or tapped by you. Used for your diary, History, patterns and the overuse guard.
- **Your medications and doses.** Each medication’s name, whether it is acute or preventive, its form and class, the dose text you write, the minimum time between doses, its schedule and whether you archived it; and each dose’s time, the attack it belongs to and whether it helped. Used for your medicine cabinet, the overuse guard, your patterns and the preventive reminders.
- **Your daily check-ins.** Your sleep time band and quality, your stress level, and whether you drank little water, had extra caffeine, drank alcohol, skipped a meal, had a heavy screen day or started your period. Tapped by you. Used for your diary and the signals.
- **Signals.** Short reasons computed by Nimbo’s code from your own records and, if you gave your area, the pressure forecast: for example a long attack, many days with medication in a month or a short night. They are reasons from your records, never predictions, risks or percentages.
- **The AI companion, only with your AI consent.** What it receives is described in the next section, [Nimbo’s AI](#ai). The server keeps only Nimbo’s short notes about you.
- **Your voice, only with the AI on and only while you hold the mic.** See [Nimbo’s AI](#ai). Nimbo never records or keeps audio.
- **Notifications, only if you allow them.** Your phone’s push token (the address push services deliver to), your phone type (iPhone or Android), when it was last registered and a fingerprint of a random code made on your phone, so only that phone can register or remove its token. If another account already holds your phone’s token, Nimbo proves your phone receives it with a one-time code sent as a silent notification; for that check the server keeps the token, your account and fingerprints of the code for up to 1 hour. To confirm delivery, the server keeps each notification’s receipt number and token for 2 days.
- **Usage counts.** How many companion messages, safety checks and dictated messages you used each day, to apply the daily limits.
- **Consent records.** Which version of this policy and of the AI text you accepted or declined, when and in which language, to prove your consent as the law requires.
- **Premium status.** Whether you have premium access, through a purchase or a grant from the owner, and until when.

The phone also schedules your preventive medication reminders itself. A reminder shows “You have a note from Nimbo” unless you turn on lock-screen details, and nothing about it reaches a server.

What Nimbo does not collect: your exact location, your contacts, your photos, advertising identifiers or any data through analytics or tracking tools. Nimbo has no ads, no analytics and no tracking, and never sells your data.

### Legal bases

Nimbo relies on these legal bases:

- **Your specific consent** (LGPD art. 11 I): your health data, and separately the AI companion and its transfer abroad.
- **Your consent** (art. 7 I): your approximate area and notifications.
- **Providing the service you ask for** (art. 7 V): your account, sign-in and its emails, your settings and your premium status.
- **Legitimate interest in a safe service** (art. 7 IX): push ownership checks, notification receipts, usage counts and sign-in security logs.
- **A legal duty** (art. 7 II and art. 8 §2): consent records, which prove your consent.

<a id="ai"></a>
## Nimbo’s AI

The AI companion runs only if you say yes on the “Nimbo’s AI and your health data” screen, and you can turn it off in Profile at any time. When it is off, nothing goes to an AI service. If this text changes, the AI stays off on your phone until you read the new version and answer again.

When you send a message, your phone sends Nimbo’s server the recent turns of the conversation (up to 12 short messages), the app’s language, your local date and time zone, and whether you typed or dictated. To answer, the server may read facts from your records (dates, intensity, symptoms, triggers, medications, your patterns and signals) and Nimbo’s notes about you. It sends these to two services, from the server, never directly from your phone:

- **Anthropic.** Claude writes the replies. When TypeSafe is unavailable, Claude also does the safety check.
- **TypeSafe.** Jev checks your message and the draft reply for warning signs and unsafe advice.

These services never receive your name, your email, your account id, your location or the ids of your records.

The conversation is stored only on your phone, which keeps the last 200 messages. The server keeps only Nimbo’s short notes, the ones you see in Profile → “What I know about you”, where you can delete any of them. Those notes stay if you turn the AI off, and you can delete them there.

Warning-sign words are also checked on your phone, in every language and with the AI off. If one matches, Nimbo shows you how to get urgent help and sends nothing.

Dictation uses your phone’s own speech recognizer. On an iPhone, it runs entirely on the phone. On Android, it runs on the phone when the language’s offline pack is installed; otherwise the phone’s default recognizer, usually Google’s, may receive the audio to transcribe it under its own terms. Only the resulting words reach Nimbo. Spoken replies use your phone’s own voices.

Anthropic and TypeSafe process this data in the United States. See [International transfers](#transfers).

<a id="where-it-is-kept"></a>
## Where your data is kept

Your account and records are kept in one Supabase project in {{DB_REGION}}. Each row belongs to your account, and the database’s security rules let only your signed-in account read it. The app talks to the server over encrypted connections, and the hosting provider encrypts the stored data.

Your phone keeps a copy of your diary so Nimbo works offline, the changes not yet sent, the companion conversation and small caches. Android backups of Nimbo’s data are turned off.

{{BACKUPS}}.

<a id="processors"></a>
## Who processes your data

These services process data for Nimbo, each only for the purpose below and under terms that require them to protect it. Nimbo calls the AI services and the weather service from its server, never from your phone.

| Recipient | What it receives | Why | Where | How long it keeps it |
|---|---|---|---|---|
| Supabase | Everything stored on the server | Hosting: the database, sign-in and the server functions | {{DB_REGION}} | Until you delete it or your account |
| Anthropic (Claude) | With the AI on: the conversation turns, facts from your records, Nimbo’s notes, the language, your local date and time zone (as an offset from UTC); the safety check’s text when TypeSafe is unavailable | Writing the companion’s replies; the backup safety check | United States | Anthropic {{ANTHROPIC_RETENTION}}. It does not train its models on this data |
| TypeSafe (Jev) | With the AI on: your message, the draft reply and the warning-sign context | Checking messages and replies for safety | United States | TypeSafe {{TYPESAFE_RETENTION}}. It does not train its models on this data |
| Open-Meteo | Only the one-decimal cell of your area, from Nimbo’s server, never anything that identifies you | The air pressure forecast | Switzerland | Its web server logs for 90 days |
| Expo (push notifications) | With notifications on: your push token and each notification’s title, plus the screen to open; the title is “You have a note from Nimbo” unless you turn on lock-screen details, which add the signal’s text; and, to prove a phone receives its token, a one-time code in a silent notification | Delivering notifications and the token check | United States | As long as reasonably necessary; delivery receipts for 1 day |
| Google (Firebase Cloud Messaging) and Apple (push service) | The same notification, from Expo | Delivering it to an Android phone or an iPhone | United States | Under their own terms |
| Google (speech recognizer, Android) | Audio while you hold the mic, when the offline language pack is missing | Turning your voice into text | Google’s servers | Under Google’s terms |
| Google and Apple (sign-in) | Your sign-in identity, if you use them | Signing you in | United States | Under their own terms |
| {{EMAIL_PROVIDER}} | Your email address and the confirmation or reset code | Sending your account’s emails | As its terms state | Its sending logs for {{EMAIL_LOG_RETENTION}} |

When you correct or delete data, Nimbo asks the recipients that keep a copy to do the same, unless that is impossible. No sale, no ads, no analytics: no one else receives your data.

<a id="transfers"></a>
## International transfers

Your account and records are stored in {{DB_REGION}}. Some services process data in other countries:

- **United States:** Anthropic and TypeSafe (with the AI on), Expo and Google’s and Apple’s push services (with notifications on), and Google’s speech recognizer (dictation on Android without the offline pack).
- **Switzerland:** Open-Meteo, which receives only a cell about 11 km across and nothing that identifies you.
- The email provider processes your email address where its terms state.

You consent to these transfers specifically, knowing they are international: on the AI screen (“Anthropic and TypeSafe process this data in the United States”) and on the notifications step. Where a provider offers contractual safeguards, they apply too; ask by email for a copy where one exists.

<a id="retention"></a>
## How long your data is kept

Nimbo keeps each kind of data only as long as its purpose needs:

- **Your records, notes, settings and premium status:** until you delete them, where the app lets you (attacks, doses and Nimbo’s notes), or delete your account. {{INACTIVE_ACCOUNTS}}.
- **Your phone’s push token:** until you sign out on that phone, the token changes, Expo reports the phone no longer accepts it, or you delete your account.
- **Consent records:** as long as your account, to prove your consent.
- **Signals:** 30 days. Only the last quiet-stretch notification sent is kept longer, so it is not sent twice.
- **Pressure forecasts:** 2 days. They are stored per area cell and are not linked to you.
- **Notification receipts:** 2 days.
- **Push ownership checks:** up to 1 hour.
- **Usage counts:** 30 days.
- **Your phone’s copies:** until you sign out, delete your account or uninstall the app. Changes not yet sent when you sign out stay on the phone until you sign in again and they are sent. The conversation is capped at the last 200 messages.
- **Sign-in security logs** (the provider’s record of sign-ins, with the IP address): {{AUTH_LOG_RETENTION}}.

Each recipient keeps what it receives as the table in [Who processes your data](#processors) says. Backups: see [Where your data is kept](#where-it-is-kept).

<a id="your-rights"></a>
## Your rights and how to use them

You have the right to:

- **Confirmation and access:** know whether Nimbo processes your data and get a copy.
- **Correction:** fix incomplete, wrong or outdated data.
- **Anonymization, blocking or deletion** of data that is unnecessary, excessive or processed unlawfully.
- **Portability:** get your data in a structured file you can take elsewhere.
- **Deletion** of the data processed with your consent.
- **Information** about who receives your data.
- **Information** about what happens if you say no to a consent.
- **Withdrawal** of your consent at any time.

In the app:

- Edit any attack, medication or check-in; delete an attack or a dose (to fix a dose, delete it and log it again); archive a medication. To erase your medications and check-ins entirely, delete your account or write to Nimbo.
- See and delete Nimbo’s notes in Profile → “What I know about you”.
- Turn the AI on or off in Profile.
- **Export my data** (Profile → “Your data”) gives you a JSON file with the records the server keeps: your account’s email, when it was created, your last sign-in and your sign-in methods, your settings, attacks, medications, doses, check-ins, Nimbo’s notes, signals, consent records, premium status, usage counts and your registered phones (phone type and last registration; never the push token). The conversation is not included: it lives only on your phone.
- **Delete my account** (Profile → “Your data”): see [Deleting your account](#delete-your-account).

By email, write to [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) from your account’s address, so Nimbo can check it is you. Requests are free and answered within 15 days. For example, write to remove your approximate area, which the app does not show after setup.

**Automated processing.** The companion’s replies and the signal rules describe your own records. They never make a decision about you. You can ask for an explanation of how a reply or a signal came about, or for a human review, by email.

**Complaints.** If you think your data is mishandled, you can complain to Brazil’s data protection authority (ANPD) or to the data protection authority of your country. You can also write to Nimbo first, and it will try to fix the problem.

<a id="delete-your-account"></a>
## Deleting your account

**In the app:** Profile → “Your data” → “Delete my account”, then confirm. Nimbo deletes your account and every row that belongs to it on the server at once. Then it clears the copy on your phone (the diary, the queue of changes, the conversation, the caches, the reminders and any export file) and signs you out. If you used Sign in with Apple, you can also remove Nimbo from your Apple ID settings.

**Without the app:** email [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) from your account’s address and ask for deletion. Your account and data are deleted within 15 days, and you get a reply when it is done.

What remains afterwards: what each recipient received, until its own retention ends ([Who processes your data](#processors)); backups, as [Where your data is kept](#where-it-is-kept) says; and the sign-in security logs, as [How long your data is kept](#retention) says.

<a id="security"></a>
## Security

Nimbo protects your data with these measures:

- Encrypted connections between the app and the server.
- Database rules that let only your signed-in account read your rows, and server functions that check who is calling.
- Encryption of the stored data by the hosting provider.
- No health text in server logs, and only the neutral “You have a note from Nimbo” on the lock screen unless you choose details.
- The AI keys stay on the server; the phone never holds them.

If a security incident could harm you, Nimbo tells the ANPD and the people affected.

<a id="not-medical-advice"></a>
## Not medical advice

Nimbo is not a medical device. It records and describes what you log; it never tells you what to take or how much, and it does not diagnose. If you type or say a warning sign, it shows you how to get urgent help and the emergency number for your country. Always talk to a health professional before a medical decision.

<a id="changes"></a>
## Changes to this policy

Each new version has a new date at the top of this page. If a change affects what Nimbo collects, why, who receives it, where it goes or who is responsible, the app shows you that the terms changed and asks for your consent again before you continue. A change to the AI text turns the AI off on your phone until you answer again.

Earlier versions, once there are any, stay published at {{POLICY_URL}}history/.

<a id="contact"></a>
## Contact

For questions and requests, write to [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com). The controller and the data protection officer are named in [Who is responsible](#controller).
