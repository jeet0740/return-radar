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

export const DEFAULT_OFFSETS = [7, 3, 1, 0];
export async function scheduleReminders(purchase: Purchase, offsets: number[] = DEFAULT_OFFSETS): Promise<string[]> {
  if (purchase.status === 'returned') return [];
  if (!(await ensureNotificationPermission())) return [];
  const ids: string[] = [];
  const deadlines = [{ date: purchase.status === 'active' ? purchase.returnDeadline : '', label: 'Return deadline' }, { date: purchase.warrantyDeadline, label: 'Warranty expiration' }];
  for (const deadline of deadlines) {
  const parsed = parseDate(deadline.date);
  if (!parsed) continue;
  for (const daysBefore of offsets) {
    if (daysUntil(deadline.date) < daysBefore) continue;
    const at = new Date(parsed);
    at.setDate(at.getDate() - daysBefore);
    at.setHours(9, 0, 0, 0);
    if (at.getTime() <= Date.now()) continue;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: deadline.label + (daysBefore === 0 ? ' is today' : ' approaching'),
          body: `${purchase.title} at ${purchase.store} — ${daysBefore === 0 ? 'check your options today' : `${daysBefore} day(s) remaining`}`,
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
  }
  return ids;
}

export async function testReminder(): Promise<void> {
  if (!(await ensureNotificationPermission())) throw new Error('Enable notifications in device Settings.');
  await Notifications.scheduleNotificationAsync({
    content: { title: 'ReturnRadar test', body: 'Your local reminders are working.', sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 15, repeats: false },
  });
}
