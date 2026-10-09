---
title: "Set up multi-location access and SSO"
description: "Add your locations, give each person the right role at the right stores, and connect single sign-on and SCIM so access follows your directory."
category: "account-and-data"
order: 1
updated: "2026-10-08"
appliesTo: ["Lumoras POS", "Lumoras Voice", "Lumoras Sound"]
review: true
---

Multi-location access lets one account run every store, clinic or shop, with each person seeing only the locations and tools their role allows. Single sign-on (SSO) lets your team sign in with your company identity provider, and SCIM keeps their access in step with your directory. Your onboarding team sets up SSO and SCIM with you.

## What this does

Owners and regional managers see rollups across every location: sales, calls and what is playing in each store. Staff at one location see only that location. With SSO, people sign in with the work account they already use, and when someone leaves, removing them from your directory removes their access to Lumoras too.

## Add locations

1. Open **Settings**, then the locations section.
2. Add each location with its name, address, time zone and business hours.
3. Copy services, menus, zones or announcements from an existing location to save time.
4. Save, then repeat for each location.

## Assign roles

1. Open **Settings**, then **Team**.
2. Add or invite each person.
3. Choose their role, such as owner, regional manager, location manager or staff.
4. Choose the locations they can access.
5. Save. Their access applies the next time they sign in.

Give each person the smallest role that lets them do their job. Refunds, payouts and data exports usually belong with managers.

## Connect SSO and SCIM

1. Tell your onboarding contact which identity provider you use.
2. Create an application for Lumoras in your identity provider, using the details your onboarding team gives you.
3. Share the connection details from your provider back with the onboarding team.
4. Test sign-in with one account before switching everyone over.
5. Turn on SCIM provisioning so new hires, role changes and departures sync automatically.

## Check that it worked

- Sign in as a location manager. Only that person's locations should be visible.
- Sign in through your identity provider and confirm you land in the right account.
- Remove a test user from your directory and confirm they can no longer sign in.
- Open the audit log and confirm sign-ins and role changes are recorded.

## Troubleshooting

- **Someone sees too much.** Check their role and the locations assigned to them under **Team**.
- **SSO sign-in fails.** Confirm the user is assigned to the Lumoras application in your identity provider.
- **A new hire has no access.** SCIM may not have synced yet, or they are not in the group you provisioned.

## Related articles

- [Enterprise features for multi-location businesses](/#enterprise)
- [Add services and staff to your POS](/help-center/add-services-and-staff)
- [Delete customer data and call history](/help-center/delete-customer-data)
- [Book a demo to plan your rollout](/demo)
