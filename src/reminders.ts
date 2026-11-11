import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Purchase } from './types';
import { daysUntil, parseDate } from './utils';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const request = await Notifications.requestPermissionsAsync();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('return-deadlines', {
      name: 'Return deadlines',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  return request.granted;
}

export async function cancelReminders(ids: string[]): Promise<void> {
  await Promise.all(ids.map(async id => {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }));
}

export async function scheduleReminders(purchase: Purchase): Promise<string[]> {
  if (purchase.status !== 'active' || !purchase.returnDeadline) return [];
  if (!(await ensureNotificationPermission())) return [];
  const parsed = parseDate(purchase.returnDeadline);
  if (!parsed) return [];
  const ids: string[] = [];
  for (const daysBefore of [7, 3, 1, 0]) {
    if (daysUntil(purchase.returnDeadline) < daysBefore) continue;
    const at = new Date(parsed);
    at.setDate(at.getDate() - daysBefore);
    at.setHours(9, 0, 0, 0);
    if (at.getTime() <= Date.now()) continue;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: daysBefore === 0 ? 'Return deadline is today' : 'Return deadline approaching',
          body: `${purchase.title} at ${purchase.store} — ${daysBefore === 0 ? 'check your return options today' : `${daysBefore} day(s) remaining`}`,
          data: { purchaseId: purchase.id },
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
      });
      ids.push(id);
    } catch (error) {
      console.warn('Could not schedule a reminder', error);
    }
  }
  return ids;
}
