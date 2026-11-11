# ReturnRadar

**Know when to return it. Never lose the receipt.**

ReturnRadar is an offline-first iOS/Android mobile app built with **React Native, Expo, TypeScript and SQLite**. Track purchases, receipt images, return windows, warranties, and local deadline reminders.

## Features implemented
- Polished light/dark dashboard with purchase statistics and urgent return deadlines
- Add, edit, delete, search and filter purchases
- Calculate deadlines from a user-provided return window, or enter a verified custom date
- Capture a receipt with the camera or choose an image; copied into persistent app storage
- Store purchases in a local SQLite database (no account or server required)
- Local notifications 7, 3, 1 days before, and on the return date when permission is granted
- Warranty tracking, purchase statuses, upcoming deadline list
- JSON export through the native share sheet
- Privacy-first: nothing is transmitted to our servers

**Important:** Receipt *photo capture* is implemented; OCR/automatic item extraction is NOT yet implemented. Retailer return policies differ and this app does not automatically verify them. Confirm the return deadline with the store. A mobile backup is not a recovery guarantee if the app is uninstalled.

## Requirements
- Node.js LTS
- npm
- Expo Go on an iPhone (or an Android device)
- For App Store builds: Expo account and Apple Developer Program membership

## Local development (Windows)

```powershell
git clone https://github.com/jeet0740/return-radar.git
cd return-radar
npm install
npx expo install --fix
npx expo start --tunnel
```

Scan the QR code with Expo Go. For most devices, `npx expo start` on the same Wi-Fi network is faster. On Windows, **do not use** `expo start --ios` because it expects a Mac/Xcode simulator.

## Code layout
- `App.tsx` — interface, tabs, forms, search, and interactions
- `src/database.ts` — SQLite persistence
- `src/reminders.ts` — permission requests, local notifications, cancellation
- `src/receipt.ts` — receipt photo capture and durable local copy
- `src/utils.ts` — dates, return urgency, formatting
- `src/types.ts` — shared TypeScript types

## iOS App Store release
1. Set your unique iOS bundle identifier in `app.json`.
2. Configure an EAS project with `npx eas-cli@latest init` (this may update `app.json`).
3. Build with `npx eas-cli@latest build --platform ios --profile production`.
4. Test on real hardware; verify notifications and receipt storage.
5. Create your App Store Connect record, legal/privacy details, screenshots, and support URL.
6. Submit only after device QA: `npx eas-cli@latest submit --platform ios`.

Builds and Apple review are **not** performed automatically by committing source code.

## Roadmap
- On-device OCR and review-before-saving extraction
- Export/import restore flow and iCloud sync
- App icon and App Store screenshots
- Accessibility, localization, end-to-end device testing

## Privacy
Receipts may contain purchase details and personal information. Data is currently kept on the device. The user can remove individual purchases; uninstalling the app also removes its local app data. There are no analytics trackers or third-party OCR services in this version.

MIT License.
