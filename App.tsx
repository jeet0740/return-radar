import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Appearance, Image, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StatusBar as NativeStatusBar, StyleSheet,
  Text, TextInput, View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listPurchases, removePurchase, savePurchase, setNotificationIds } from './src/database';
import { cancelReminders, scheduleReminders, ensureNotificationPermission, DEFAULT_OFFSETS, testReminder } from './src/reminders';
import { acquireReceipt, deleteReceipt, ReceiptSource } from './src/receipt';
import { scanReceipt, ReceiptItem } from './src/ocr';
import { Purchase, PurchaseInput, PurchaseStatus } from './src/types';
import { addDays, dateToday, daysUntil, deadlineLabel, displayDate, money, parseDate, purchaseUrgency } from './src/utils';

type Tab = 'home' | 'purchases' | 'deadlines' | 'settings';
type Filter = 'all' | 'active' | 'expired' | 'returned';
type ThemeOption = 'system' | 'light' | 'dark';
type Form = {
  title: string; store: string; price: string; purchaseDate: string; returnDays: string;
  returnDeadline: string; customDeadline: boolean; warrantyDeadline: string;
  notes: string; receiptUri: string; status: PurchaseStatus;
};
const BLUE = '#5865E8';
const INK = '#17243F';
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; selected: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'home', label: 'Home', icon: 'home-outline', selected: 'home' },
  { key: 'purchases', label: 'Purchases', icon: 'receipt-outline', selected: 'receipt' },
  { key: 'deadlines', label: 'Deadlines', icon: 'calendar-outline', selected: 'calendar' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', selected: 'settings' },
];
const blank = (): Form => ({
  title: '', store: '', price: '', purchaseDate: dateToday(), returnDays: '30',
  returnDeadline: addDays(dateToday(), 30), customDeadline: false,
  warrantyDeadline: '', notes: '', receiptUri: '', status: 'active',
});
function toForm(p: Purchase): Form {
  return {
    title: p.title, store: p.store, price: String(p.price), purchaseDate: p.purchaseDate,
    returnDays: String(Math.max(0, daysBetween(p.purchaseDate, p.returnDeadline))),
    returnDeadline: p.returnDeadline, customDeadline: true,
    warrantyDeadline: p.warrantyDeadline, notes: p.notes, receiptUri: p.receiptUri, status: p.status,
  };
}
function daysBetween(a: string, b: string) {
  const da = parseDate(a), db = parseDate(b);
  return da && db ? Math.round((db.getTime() - da.getTime()) / 86400000) : 30;
}
const themes = {
  light: { bg: '#F5F7FD', surface: '#FFFFFF', text: '#17243F', secondary: '#758099', border: '#E9EDF5', muted: '#EFF2FB', input: '#F7F8FC', brand: BLUE },
  dark: { bg: '#0D1424', surface: '#192339', text: '#F0F4FF', secondary: '#A1ADC6', border: '#2B3852', muted: '#27334C', input: '#222E46', brand: '#8E98FF' },
};
type Colors = typeof themes.light;
function Tag({ text, kind, c }: { text: string; kind: 'safe' | 'soon' | 'expired' | 'done'; c: Colors }) {
  const styles = {
    safe: ['#DFF8ED', '#13855D'], soon: ['#FFF1D8', '#A96800'],
    expired: ['#FDE5E8', '#BB3B4B'], done: [c.muted, c.secondary],
  };
  return <View style={{ backgroundColor: styles[kind][0], paddingHorizontal: 10, paddingVertical: 6, borderRadius: 30 }}>
    <Text style={{ color: styles[kind][1], fontWeight: '700', fontSize: 11 }}>{text}</Text>
  </View>;
}
function IconBox({ name, tint = BLUE, background = '#EEF0FF', size = 21 }: { name: keyof typeof Ionicons.glyphMap; tint?: string; background?: string; size?: number }) {
  return <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name={name} size={size} color={tint} />
  </View>;
}
function Field({ label, value, onChangeText, placeholder, c, keyboardType = 'default', multiline = false, hint }: {
  label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; c: Colors;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'; multiline?: boolean; hint?: string;
}) {
  return <View style={{ marginBottom: 16 }}>
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>{label}</Text>
    <TextInput
      accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor={c.secondary} keyboardType={keyboardType} multiline={multiline}
      style={{
        minHeight: multiline ? 94 : 49, backgroundColor: c.input, borderRadius: 14, color: c.text,
        paddingHorizontal: 15, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: c.border,
        textAlignVertical: multiline ? 'top' : 'center'
      }}
    />
    {hint ? <Text style={{ color: c.secondary, fontSize: 11, marginTop: 5 }}>{hint}</Text> : null}
  </View>;
}
function AppContent() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [viewer, setViewer] = useState(false);
  const [calendar, setCalendar] = useState<'purchaseDate' | 'returnDeadline' | 'warrantyDeadline' | null>(null);
  const [month, setMonth] = useState(new Date());
  const system = Appearance.getColorScheme();
  const [themeOption, setThemeOption] = useState<ThemeOption>('system');
  const dark = themeOption === 'dark' || (themeOption === 'system' && system === 'dark');
  const c = dark ? themes.dark : themes.light;
  const [tab, setTab] = useState<Tab>('home');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_OFFSETS);
  const [reminderBusy, setReminderBusy] = useState(false);

  const reload = useCallback(async () => setPurchases(await listPurchases()), []);
  useEffect(() => {
    (async () => {
      try {
        const [items, option, reminderValue, offsetValue] = await Promise.all([
          listPurchases(), AsyncStorage.getItem('theme'), AsyncStorage.getItem('remindersEnabled'), AsyncStorage.getItem('reminderOffsets'),
        ]);
        setPurchases(items);
        if (option === 'light' || option === 'dark' || option === 'system') setThemeOption(option);
        if (offsetValue) { const saved: unknown = JSON.parse(offsetValue); if (Array.isArray(saved)) setOffsets(DEFAULT_OFFSETS.filter(n => saved.includes(n))); }
        if (reminderValue !== null) setRemindersEnabled(reminderValue === 'true');
      } catch (error) { Alert.alert('Unable to load purchases', String(error)); }
      finally { setBusy(false); }
    })();
  }, []);

  const active = purchases.filter(p => p.status === 'active');
  const soon = active.filter(p => p.returnDeadline && daysUntil(p.returnDeadline) >= 0 && daysUntil(p.returnDeadline) <= 7);
  const upcoming = active.filter(p => p.returnDeadline && daysUntil(p.returnDeadline) >= 0).sort((a, b) => a.returnDeadline.localeCompare(b.returnDeadline));
  const expired = active.filter(p => p.returnDeadline && daysUntil(p.returnDeadline) < 0);
  const warranties = purchases.filter(p => p.warrantyDeadline && daysUntil(p.warrantyDeadline) >= 0);
  const visible = useMemo(() => purchases.filter(p => {
    const matches = `${p.title} ${p.store} ${p.notes}`.toLowerCase().includes(search.toLowerCase());
    if (!matches) return false;
    return filter === 'all' || (filter === 'active' && p.status === 'active' && !(p.returnDeadline && daysUntil(p.returnDeadline) < 0))
      || (filter === 'expired' && p.status === 'active' && p.returnDeadline && daysUntil(p.returnDeadline) < 0)
      || (filter === 'returned' && p.status === 'returned');
  }), [purchases, filter, search]);

  const panel = { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 20 };
  const subtitle = { color: c.secondary, fontSize: 13 } as const;
  const heading = { color: c.text, fontSize: 21, fontWeight: '800' as const, letterSpacing: -0.5 };
  const sectionHeader = (title: string, count?: number) => <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
    <Text style={{ ...heading, fontSize: 18 }}>{title}</Text>
    {typeof count === 'number' ? <Text style={subtitle}>{count} items</Text> : null}
  </View>;

  function openAdd() { setItems([]); setSelected([]); setCalendar(null); setEditing(null); setForm(blank()); setScanMessage(''); setModal(true); }
  function openEdit(p: Purchase) { setItems([]); setSelected([]); setCalendar(null); setViewer(false); setDetail(null); setEditing(p); setForm(toForm(p)); setScanMessage(''); setModal(true); }
  function changeForm<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if ((key === 'purchaseDate' || key === 'returnDays') && !next.customDeadline && parseDate(next.purchaseDate)) {
        const days = Number(next.returnDays);
        if (Number.isInteger(days) && days >= 0 && days <= 3650) next.returnDeadline = addDays(next.purchaseDate, days);
      }
      return next;
    });
  }
  async function photo(source: ReceiptSource) {
    if (scanning) return;
    setScanning(true);
    setScanMessage('Reading receipt on your iPhone…');
    try {
      const uri = await acquireReceipt(source);
      if (!uri) { setScanMessage(''); return; }
      setForm(prev => ({ ...prev, receiptUri: uri }));
      try {
        const result = await scanReceipt(uri);
        setItems(result.items); setSelected([]);
        const fields = [result.store && 'store', result.total !== null && 'total', result.date && 'date', result.items.length && 'products', result.returnDays && 'return window'].filter(Boolean);
        if (fields.length === 0) {
          setScanMessage('Receipt attached. No reliable details detected; enter them manually.');
        } else {
          setScanMessage(`Found ${fields.join(', ')}. Confirm the detected values to fill the form.`);
          Alert.alert(
            'Receipt details found',
            `Store: ${result.store || 'Not found'}\nTotal: ${result.total !== null ? '$' + result.total.toFixed(2) : 'Not found'}\nDate: ${result.date || 'Not found'}\n\nProducts: ${result.items.length}\nReturn window: ${result.returnDays ?? 'Not found'} days (verify policy)\n\nApply these details to the purchase form?`,
            [
              { text: 'Keep current fields', style: 'cancel' },
              {
                text: 'Apply details',
                onPress: () => {
                  setForm(prev => {
                    const next = { ...prev, receiptUri: uri };
                    if (result.store) next.store = result.store;
                    if (result.items.length === 1) { next.title = result.items[0].title; next.price = result.items[0].price.toFixed(2); }
                    else if (result.items.length > 1) { next.title = ''; next.price = ''; }
                    else if (result.total !== null) next.price = result.total.toFixed(2);
                    if (result.returnDays && !prev.customDeadline) next.returnDays = String(result.returnDays);
                    if (result.date) next.purchaseDate = result.date;
                    if (result.date || result.returnDays) {
                      if (!prev.customDeadline) {
                        const days = Number(next.returnDays);
                        if (Number.isInteger(days) && days >= 0 && days <= 3650) {
                          next.returnDeadline = addDays(next.purchaseDate, days);
                        }
                      }
                    }
                    return next;
                  });
                  setScanMessage('Scanned details applied. Review and correct them before saving.');
                },
              },
            ],
          );
        }
      } catch (error) {
        setScanMessage('Receipt attached, but text recognition failed. You can enter details manually.');
        console.warn('Receipt OCR failed', error);
      }
    } catch (e) { Alert.alert('Receipt unavailable', String(e)); setScanMessage(''); }
    finally { setScanning(false); }
  }
  function choosePhoto() {
    Alert.alert('Scan receipt', 'Attach a receipt image and read its text on-device. Review all detected details.', [
      { text: 'Take photo', onPress: () => { void photo('camera'); } },
      { text: 'Choose photo', onPress: () => { void photo('library'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  async function persist() {
    if (saving || scanning) return;
    const batch = !editing && selected.length > 1;
    if ((!batch && !form.title.trim()) || !form.store.trim()) { Alert.alert('Missing details', 'Enter a product and store name.'); return; }
    if (!parseDate(form.purchaseDate)) { Alert.alert('Invalid date', 'Purchase date must be YYYY-MM-DD.'); return; }
    if (form.returnDeadline && (!parseDate(form.returnDeadline) || form.returnDeadline < form.purchaseDate)) {
      Alert.alert('Invalid return date', 'Enter a valid YYYY-MM-DD return date on or after purchase.'); return;
    }
    if (form.warrantyDeadline && !parseDate(form.warrantyDeadline)) {
      Alert.alert('Invalid warranty date', 'Enter a valid YYYY-MM-DD warranty date, or leave it blank.'); return;
    }
    const price = Number(form.price || '0');
    if (!Number.isFinite(price) || price < 0) { Alert.alert('Invalid price', 'Enter a valid price.'); return; }
    setSaving(true);
    try {
      const input: PurchaseInput = {
        title: form.title.trim(), store: form.store.trim(), price, purchaseDate: form.purchaseDate,
        returnDeadline: form.returnDeadline, warrantyDeadline: form.warrantyDeadline,
        notes: form.notes.trim(), receiptUri: form.receiptUri, status: form.status,
      };
      if (batch) {
        for (const index of selected) {
          const item = items[index];
          if (!item) continue;
          const updated = await savePurchase({ ...input, title: item.title, price: item.price });
          setSelected(prev => prev.filter(i => i !== index));
          try { await setNotificationIds(updated.id, remindersEnabled ? await scheduleReminders(updated, offsets) : []); } catch (error) { console.warn('Reminder setup failed', error); }
        }
        await reload(); setModal(false); setEditing(null); return;
      }
      const updated = await savePurchase(input, editing ?? undefined);
      if (editing) await cancelReminders(editing.notificationIds);
      const ids = remindersEnabled ? await scheduleReminders(updated, offsets) : [];
      await setNotificationIds(updated.id, ids);
      if (editing?.receiptUri && editing.receiptUri !== updated.receiptUri) { if (!(await listPurchases()).some(p => p.receiptUri === editing.receiptUri)) await deleteReceipt(editing.receiptUri); }
      await reload();
      setModal(false); setEditing(null);
    } catch (error) { Alert.alert('Could not save', String(error)); }
    finally { setSaving(false); }
  }
  async function setStatus(p: Purchase, status: PurchaseStatus) {
    try {
      await cancelReminders(p.notificationIds);
      const updated = await savePurchase({ title: p.title, store: p.store, price: p.price, purchaseDate: p.purchaseDate, returnDeadline: p.returnDeadline, warrantyDeadline: p.warrantyDeadline, notes: p.notes, receiptUri: p.receiptUri, status }, p);
      const ids = remindersEnabled ? await scheduleReminders(updated, offsets) : [];
      await setNotificationIds(updated.id, ids);
      await reload(); setDetail(null);
    } catch (error) { Alert.alert('Unable to update', String(error)); }
  }
  function confirmDelete(p: Purchase) {
    Alert.alert('Delete purchase?', 'This purchase and its saved receipt will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' }, {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await cancelReminders(p.notificationIds);
            await removePurchase(p.id);
            if (!(await listPurchases()).some(other => other.receiptUri === p.receiptUri)) await deleteReceipt(p.receiptUri);
            setDetail(null); await reload();
          } catch (error) { Alert.alert('Unable to delete', String(error)); }
        }
      }
    ]);
  }
  async function exportData() {
    try {
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Sharing unavailable', 'Sharing is not available on this device.'); return; }
      const uri = `${FileSystem.cacheDirectory}returnradar-export-${dateToday()}.json`;
      const images: Record<string, string> = {};
      const safe = [];
      for (const { notificationIds, ...p } of await listPurchases()) {
        if (p.receiptUri && !images[p.receiptUri]) {
          images[p.receiptUri] = await FileSystem.readAsStringAsync(p.receiptUri, { encoding: FileSystem.EncodingType.Base64 });
        }
        safe.push(p);
      }
      await FileSystem.writeAsStringAsync(uri, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), purchases: safe, images, settings: { themeOption, remindersEnabled, offsets } }));
      await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Export ReturnRadar data' });
    } catch (error) { Alert.alert('Export failed', String(error)); }
  }
  async function chooseTheme(option: ThemeOption) {
    setThemeOption(option); await AsyncStorage.setItem('theme', option);
  }
  async function toggleReminders(value: boolean, nextOffsets = offsets) {
    if (reminderBusy) return;
    setReminderBusy(true);
    try {
      if (value && !(await ensureNotificationPermission())) {
        Alert.alert('Permission needed', 'Enable notifications in your device Settings.'); return;
      }
      setRemindersEnabled(value); setOffsets(nextOffsets); await AsyncStorage.setItem('remindersEnabled', String(value)); await AsyncStorage.setItem('reminderOffsets', JSON.stringify(nextOffsets));
      for (const purchase of purchases) {
        await cancelReminders(purchase.notificationIds);
        const ids = value ? await scheduleReminders(purchase, nextOffsets) : [];
        await setNotificationIds(purchase.id, ids);
      }
      await reload();
    } catch (error) { Alert.alert('Reminder settings error', String(error)); } finally { setReminderBusy(false); }
  }

  const actionButton = (label: string, onPress: () => void, icon: keyof typeof Ionicons.glyphMap = 'add', light = false) =>
    <Pressable onPress={onPress} style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: light ? c.muted : c.brand, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 15, gap: 7,
    }}>
      <Ionicons name={icon} size={18} color={light ? c.text : '#FFFFFF'} />
      <Text style={{ fontWeight: '800', color: light ? c.text : '#FFFFFF', fontSize: 14 }}>{label}</Text>
    </Pressable>;

  function purchaseCard(p: Purchase) {
    const urgency = purchaseUrgency(p);
    return <Pressable key={p.id} onPress={() => { setViewer(false); setDetail(p); }} style={{ ...panel, flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 10 }}>
      <IconBox name="bag-handle-outline" background={dark ? c.muted : '#EEF0FF'} tint={c.brand}/>
      <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: '800' }}>{p.title}</Text>
        <Text numberOfLines={1} style={{ color: c.secondary, fontSize: 12, marginTop: 4 }}>{p.store}  ·  {money(p.price)}</Text>
        <Text style={{ color: c.secondary, fontSize: 11, marginTop: 5 }}>{p.returnDeadline ? displayDate(p.returnDeadline) : 'Return date not set'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Tag text={deadlineLabel(p)} kind={urgency} c={c} />
        <Ionicons name="chevron-forward" color={c.secondary} size={15} />
      </View>
    </Pressable>;
  }
  function emptyState(icon: keyof typeof Ionicons.glyphMap, title: string, message: string, offerAdd = false) {
    return <View style={{ ...panel, padding: 30, alignItems: 'center', gap: 10 }}>
      <IconBox name={icon} size={26} background={c.muted} tint={c.brand} />
      <Text style={{ color: c.text, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>{title}</Text>
      <Text style={{ ...subtitle, textAlign: 'center', lineHeight: 20 }}>{message}</Text>
      {offerAdd ? <View style={{ marginTop: 8 }}>{actionButton('Add first purchase', openAdd)}</View> : null}
    </View>;
  }
  const header = (eyebrow: string, title: string, description: string) => <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22 }}>
    <Text style={{ color: c.brand, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, marginBottom: 7 }}>{eyebrow}</Text>
    <Text style={{ ...heading, fontSize: 29 }}>{title}</Text>
    <Text style={{ ...subtitle, marginTop: 7, lineHeight: 20 }}>{description}</Text>
  </View>;

  function home() {
    return <>
      <View style={{ paddingHorizontal: 22, paddingTop: 20, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: c.secondary, fontSize: 13, fontWeight: '600' }}>Welcome to</Text>
          <Text style={{ color: c.text, fontSize: 30, fontWeight: '900', letterSpacing: -1 }}>Return<Text style={{ color: c.brand }}>Radar</Text></Text>
        </View>
        <Pressable onPress={() => setTab('deadlines')} accessibilityLabel="View deadlines" style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border }}>
          <Ionicons name="notifications-outline" size={22} color={c.text} />
          {soon.length > 0 ? <View style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: '#F39B38' }} /> : null}
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <LinearGradient colors={dark ? ['#4854B8', '#283777'] : ['#6876F7', '#4353CF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 25, padding: 23, overflow: 'hidden', marginBottom: 22 }}>
          <Ionicons name="shield-checkmark-outline" size={92} color="#FFFFFF" style={{ opacity: 0.12, position: 'absolute', right: -6, top: 7 }} />
          <Text style={{ color: '#E2E6FF', fontSize: 13, fontWeight: '700' }}>STAY AHEAD OF DEADLINES</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginTop: 9 }}>{soon.length ? `${soon.length} return${soon.length === 1 ? '' : 's'} due soon` : 'Shop with confidence'}</Text>
          <Text style={{ color: '#EFF0FF', fontSize: 13, marginTop: 7, lineHeight: 19 }}>Your receipts, returns and warranties. All in one place.</Text>
          <View style={{ alignSelf: 'flex-start', marginTop: 20 }}>
            <Pressable onPress={openAdd} style={{ backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 17, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="add-circle" color="#4353CF" size={20}/>
              <Text style={{ color: '#4353CF', fontWeight: '800' }}>Add purchase</Text>
            </Pressable>
          </View>
        </LinearGradient>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 27 }}>
          {[
            { label: 'ACTIVE', count: active.length, icon: 'bag-handle-outline' as const, color: c.brand },
            { label: 'DUE SOON', count: soon.length, icon: 'time-outline' as const, color: '#E6A348' },
            { label: 'WARRANTIES', count: warranties.length, icon: 'shield-outline' as const, color: '#2BA982' },
          ].map(s => <View key={s.label} style={{ ...panel, flex: 1, paddingVertical: 18, alignItems: 'center', gap: 9 }}>
            <Ionicons name={s.icon} color={s.color} size={21}/>
            <Text style={{ color: c.text, fontWeight: '900', fontSize: 24 }}>{s.count}</Text>
            <Text style={{ color: c.secondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.4 }}>{s.label}</Text>
          </View>)}
        </View>
        {sectionHeader('Upcoming returns', upcoming.length)}
        {upcoming.length ? upcoming.slice(0, 3).map(purchaseCard) : emptyState('calendar-clear-outline', 'Nothing due soon', 'Your upcoming return deadlines will appear here.', purchases.length === 0)}
        {purchases.length ? <Pressable onPress={() => setTab('purchases')} style={{ paddingVertical: 17, alignItems: 'center' }}>
          <Text style={{ color: c.brand, fontWeight: '800' }}>View all purchases  →</Text>
        </Pressable> : null}
        {expired.length ? <View style={{ marginTop: 10 }}>{sectionHeader('Past return windows', expired.length)}{expired.slice(0, 2).map(purchaseCard)}</View> : null}
      </View>
    </>;
  }
  function purchasesScreen() {
    const options: { key: Filter; label: string }[] = [
      { key: 'all', label: 'All' }, { key: 'active', label: 'Active' },
      { key: 'expired', label: 'Expired' }, { key: 'returned', label: 'Returned' }
    ];
    return <>
      {header('YOUR COLLECTION', 'Purchases', 'Everything you bought, organized in one place.')}
      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ ...panel, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginBottom: 14 }}>
          <Ionicons name="search-outline" size={20} color={c.secondary}/>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search products or stores" placeholderTextColor={c.secondary} style={{ color: c.text, flex: 1, height: 48, paddingHorizontal: 10, fontSize: 14 }}/>
          {search ? <Pressable onPress={() => setSearch('')}><Ionicons name="close-circle" size={20} color={c.secondary}/></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 19 }}>
          {options.map(o => <Pressable key={o.key} onPress={() => setFilter(o.key)} style={{ backgroundColor: filter === o.key ? c.brand : c.surface, borderWidth: 1, borderColor: filter === o.key ? c.brand : c.border, paddingHorizontal: 19, paddingVertical: 11, borderRadius: 25, marginRight: 8 }}>
            <Text style={{ color: filter === o.key ? '#FFFFFF' : c.secondary, fontWeight: '800', fontSize: 12 }}>{o.label}</Text>
          </Pressable>)}
        </ScrollView>
        {sectionHeader('Saved purchases', visible.length)}
        {visible.length ? visible.map(purchaseCard) : emptyState('receipt-outline', 'No matching purchases', 'Add a purchase or try a different search or filter.', purchases.length === 0)}
      </View>
    </>;
  }
  function deadlinesScreen() {
    const sortedWarranties = [...warranties].sort((a, b) => a.warrantyDeadline.localeCompare(b.warrantyDeadline));
    return <>
      {header('DON’T MISS A DATE', 'Deadlines', 'Keep return periods and warranties on your radar.')}
      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ ...panel, padding: 18, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconBox name="alarm-outline" tint="#CD8B29" background={dark ? c.muted : '#FFF3DB'}/>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{soon.length} return{soon.length === 1 ? '' : 's'} in the next 7 days</Text>
            <Text style={{ ...subtitle, marginTop: 4 }}>Review your store policy before the deadline.</Text>
          </View>
        </View>
        {sectionHeader('Upcoming returns', upcoming.length)}
        {upcoming.length ? upcoming.map(purchaseCard) : emptyState('checkmark-circle-outline', 'All caught up', 'No upcoming return deadlines.')}
        {expired.length ? <View style={{ marginTop: 24 }}>{sectionHeader('Expired return windows', expired.length)}{expired.map(purchaseCard)}</View> : null}
        <View style={{ marginTop: 24 }}>
          {sectionHeader('Warranty coverage', sortedWarranties.length)}
          {sortedWarranties.length ? sortedWarranties.map(p => <Pressable key={p.id} onPress={() => setDetail(p)} style={{ ...panel, padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconBox name="shield-checkmark-outline" tint="#238B6C" background={dark ? c.muted : '#E3F8ED'}/>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>{p.title}</Text>
              <Text style={{ ...subtitle, marginTop: 4 }}>Until {displayDate(p.warrantyDeadline)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={c.secondary}/>
          </Pressable>) : emptyState('shield-outline', 'No active warranties', 'Add a warranty expiration date to a purchase.')}
        </View>
      </View>
    </>;
  }
  function settingsScreen() {
    return <>
      {header('MAKE IT YOURS', 'Settings', 'Personalize your experience and protect your records.')}
      <View style={{ paddingHorizontal: 20 }}>
        <Text style={{ color: c.text, fontWeight: '900', fontSize: 16, marginBottom: 13 }}>Appearance</Text>
        <View style={{ ...panel, padding: 13, gap: 7, marginBottom: 24 }}>
          {(['system', 'light', 'dark'] as ThemeOption[]).map(o => <Pressable key={o} onPress={() => { void chooseTheme(o); }} style={{ padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeOption === o ? c.muted : 'transparent' }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Ionicons name={o === 'system' ? 'phone-portrait-outline' : o === 'light' ? 'sunny-outline' : 'moon-outline'} size={20} color={c.brand}/>
              <Text style={{ color: c.text, fontWeight: '700', textTransform: 'capitalize' }}>{o === 'system' ? 'Follow system' : o}</Text>
            </View>
            {themeOption === o ? <Ionicons name="checkmark-circle" color={c.brand} size={22}/> : null}
          </Pressable>)}
        </View>
        <Text style={{ color: c.text, fontWeight: '900', fontSize: 16, marginBottom: 13 }}>Preferences</Text>
        <Pressable onPress={() => { void toggleReminders(!remindersEnabled); }} style={{ ...panel, padding: 17, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBox name="notifications-outline" tint={c.brand} background={c.muted}/>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '800' }}>Deadline reminders</Text>
            <Text style={{ ...subtitle, marginTop: 4 }}>Local notifications for returns and warranties</Text>
          </View>
          <Ionicons name={remindersEnabled ? 'toggle' : 'toggle-outline'} color={remindersEnabled ? c.brand : c.secondary} size={36}/>
        </Pressable>
        <View style={{ ...panel, padding: 17, marginBottom: 12, gap: 10 }}>
          <Text style={{ color: c.text, fontWeight: '800' }}>Reminder schedule</Text>
          <Text style={subtitle}>At 9 AM local time, for returns and warranties. Changing these options reschedules existing purchases.</Text>
          {DEFAULT_OFFSETS.map(n => <Pressable key={n} disabled={reminderBusy} onPress={() => { void toggleReminders(remindersEnabled, offsets.includes(n) ? offsets.filter(x => x !== n) : DEFAULT_OFFSETS.filter(x => x === n || offsets.includes(x))); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Ionicons name={offsets.includes(n) ? 'checkbox' : 'square-outline'} size={24} color={c.brand}/>
            <Text style={{ color: c.text }}>{n === 0 ? 'On deadline day' : n + ' day(s) before'}</Text>
          </Pressable>)}
          {actionButton('Test notification (15 seconds)', () => { void testReminder().then(() => Alert.alert('Test scheduled', 'Go to your Home Screen and wait 15 seconds.')).catch(e => Alert.alert('Notification error', String(e))); }, 'notifications-outline', true)}
          {actionButton('Refresh all reminders', () => { void toggleReminders(remindersEnabled); }, 'refresh-outline', true)}
        </View>
        <Pressable onPress={() => { void exportData(); }} style={{ ...panel, padding: 17, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBox name="share-outline" tint={c.brand} background={c.muted}/>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '800' }}>Create full backup</Text>
            <Text style={{ ...subtitle, marginTop: 4 }}>Save purchases, receipt images and preferences</Text>
          </View>
          <Ionicons name="chevron-forward" color={c.secondary} size={18}/>
        </Pressable>
        <View style={{ ...panel, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: c.text, fontWeight: '800', marginBottom: 8 }}>Your privacy matters</Text>
          <Text style={{ ...subtitle, lineHeight: 21 }}>Your purchases and receipt photos stay on this device. No login, tracking, or server uploads. Exports are unencrypted; share them carefully. Retail return periods must be verified with each store.</Text>
        </View>
        <View style={{ ...panel, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: c.text, fontWeight: '800', marginBottom: 8 }}>Terms of use</Text>
          <Text style={{ ...subtitle, lineHeight: 21 }}>ReturnRadar is a personal recordkeeping tool. OCR and suggested deadlines may be inaccurate. Verify retailer policies and warranty terms yourself. Notifications are a convenience and delivery is not guaranteed. Keep independent copies of important receipts.</Text>
        </View>
        <Text style={{ ...subtitle, textAlign: 'center', marginBottom: 22 }}>ReturnRadar v1.0 • Made for mindful shopping</Text>
      </View>
    </>;
  }
  function detailModal() {
    if (!detail) return null;
    const p = purchases.find(x => x.id === detail.id) ?? detail;
    return <Modal visible={!!detail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ paddingHorizontal: 22, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ ...heading, fontSize: 20 }}>Purchase details</Text>
          <Pressable onPress={() => setDetail(null)}><Ionicons name="close-circle" color={c.secondary} size={29}/></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 50 }}>
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <IconBox name="bag-handle-outline" size={25} background={c.muted} tint={c.brand}/>
            <Text style={{ ...heading, marginTop: 13, textAlign: 'center' }}>{p.title}</Text>
            <Text style={{ ...subtitle, marginTop: 6 }}>{p.store} · {money(p.price)}</Text>
            <View style={{ marginTop: 13 }}><Tag text={deadlineLabel(p)} kind={purchaseUrgency(p)} c={c}/></View>
          </View>
          {p.receiptUri ? <Pressable onPress={() => setViewer(!viewer)}><Image source={{ uri: p.receiptUri }} resizeMode="contain" style={{ width: '100%', height: 220, borderRadius: 15, backgroundColor: c.muted }}/><Text style={{ color: c.brand, textAlign: 'center', marginVertical: 10 }}>Tap to enlarge receipt</Text></Pressable> : null}
          {viewer && p.receiptUri ? <View style={{ ...panel, height: 520, marginBottom: 15 }}><ScrollView maximumZoomScale={5} minimumZoomScale={1} centerContent><Image source={{ uri: p.receiptUri }} resizeMode="contain" style={{ width: '100%', height: 510 }}/></ScrollView>{actionButton('Close enlarged receipt', () => setViewer(false), 'close-outline', true)}</View> : null}
          <View style={{ ...panel, padding: 18, gap: 17, marginBottom: 18 }}>
            {([
              ['Purchase date', displayDate(p.purchaseDate)],
              ['Return deadline', p.returnDeadline ? displayDate(p.returnDeadline) : 'Not set'],
              ['Warranty until', p.warrantyDeadline ? displayDate(p.warrantyDeadline) : 'Not set'],
              ['Status', p.status.charAt(0).toUpperCase() + p.status.slice(1)],
            ] as [string, string][]).map(([label, value]) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={subtitle}>{label}</Text>
              <Text style={{ color: c.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
            </View>)}
            {p.notes ? <View><Text style={subtitle}>Notes</Text><Text style={{ color: c.text, marginTop: 5, lineHeight: 21 }}>{p.notes}</Text></View> : null}
          </View>
          <View style={{ gap: 11 }}>
            {actionButton('Edit purchase', () => openEdit(p), 'create-outline')}
            {p.status === 'active' ? <>
              {actionButton('Mark as returned', () => { void setStatus(p, 'returned'); }, 'checkmark-circle-outline', true)}
              {actionButton('Keep this item', () => { void setStatus(p, 'kept'); }, 'heart-outline', true)}
            </> : actionButton('Mark active again', () => { void setStatus(p, 'active'); }, 'refresh-outline', true)}
            <Pressable onPress={() => confirmDelete(p)} style={{ alignItems: 'center', padding: 16 }}><Text style={{ color: '#C95058', fontWeight: '800' }}>Delete purchase</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>;
  }
  function dateCalendar(key: 'purchaseDate' | 'returnDeadline' | 'warrantyDeadline') {
    return <View style={{ marginBottom: 12 }}>
      {actionButton('Choose date', () => { setMonth(parseDate(form[key]) ?? new Date()); setCalendar(calendar === key ? null : key); }, 'calendar-outline', true)}
      {calendar === key ? <View style={{ ...panel, padding: 12, marginTop: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))}><Ionicons name="chevron-back" size={24} color={c.brand}/></Pressable>
          <Text style={{ color: c.text, fontWeight: '800' }}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))}><Ionicons name="chevron-forward" size={24} color={c.brand}/></Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
          {['S','M','T','W','T','F','S'].map((d,i) => <Text key={'h'+i} style={{ width: '14.28%', textAlign: 'center', color: c.secondary }}>{d}</Text>)}
          {Array.from({ length: new Date(month.getFullYear(), month.getMonth(), 1).getDay() }, (_,i) => <View key={'b'+i} style={{ width: '14.28%', height: 38 }}/>)}
          {Array.from({ length: new Date(month.getFullYear(), month.getMonth()+1, 0).getDate() }, (_,i) => {
            const value = [month.getFullYear(), String(month.getMonth()+1).padStart(2,'0'), String(i+1).padStart(2,'0')].join('-');
            return <Pressable key={value} onPress={() => { if (key === 'returnDeadline') setForm(prev => ({ ...prev, returnDeadline: value, customDeadline: true })); else changeForm(key, value); setCalendar(null); }} style={{ width: '14.28%', height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: form[key] === value ? c.muted : 'transparent' }}><Text style={{ color: c.text }}>{i+1}</Text></Pressable>;
          })}
        </View>
      </View> : null}
    </View>;
  }
  function formModal() {
    return <Modal visible={modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ paddingHorizontal: 22, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ ...heading, fontSize: 22 }}>{editing ? 'Edit purchase' : 'New purchase'}</Text>
          <Pressable onPress={() => setModal(false)}><Ionicons name="close-circle" size={29} color={c.secondary}/></Pressable>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 50 }}>
            <Pressable onPress={choosePhoto} disabled={scanning} style={{ ...panel, padding: 18, alignItems: 'center', borderStyle: 'dashed', marginBottom: 22, opacity: scanning ? 0.65 : 1 }}>
              {form.receiptUri ? <Image source={{ uri: form.receiptUri }} resizeMode="contain" style={{ width: '100%', height: 150, borderRadius: 12 }}/>: <IconBox name="camera-outline" size={29} tint={c.brand} background={c.muted}/>}
              <Text style={{ color: c.text, fontWeight: '800', marginTop: 10 }}>{scanning ? 'Scanning receipt…' : form.receiptUri ? 'Scan another receipt' : 'Scan receipt'}</Text>
              <Text style={{ ...subtitle, textAlign: 'center', marginTop: 4 }}>Take a photo or choose from your library</Text>
              {scanning ? <ActivityIndicator style={{ marginTop: 10 }} color={c.brand}/> : null}
              {scanMessage ? <Text style={{ color: c.brand, marginTop: 9, textAlign: 'center', fontSize: 12 }}>{scanMessage}</Text> : null}
            </Pressable>
            {items.length ? <View style={{ ...panel, padding: 12, marginBottom: 16 }}>
              <Text style={{ color: c.text, fontWeight: '800', marginBottom: 8 }}>Detected products — select items</Text>
              {!editing ? <Pressable onPress={() => { const all = selected.length === items.length ? [] : items.map((_, i) => i); setSelected(all); if (all.length === 1) setForm(prev => ({ ...prev, title: items[0].title, price: items[0].price.toFixed(2) })); }}><Text style={{ color: c.brand, paddingVertical: 10 }}>{selected.length === items.length ? 'Clear selection' : 'Select all'}</Text></Pressable> : null}
              {items.map((item, i) => <Pressable key={i} onPress={() => { const next = editing ? [i] : selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i]; setSelected(next); if (next.length === 1) setForm(prev => ({ ...prev, title: items[next[0]].title, price: items[next[0]].price.toFixed(2) })); }} style={{ paddingVertical: 12, flexDirection: 'row', gap: 10, borderBottomWidth: 1, borderColor: c.border }}>
                <Ionicons name={selected.includes(i) ? 'checkbox' : 'square-outline'} size={22} color={c.brand}/><Text style={{ color: c.text, flex: 1 }}>{item.title}</Text><Text style={{ color: c.brand }}>{money(item.price)}</Text>
              </Pressable>)}
              <Text style={{ ...subtitle, marginTop: 8 }}>Item prices exclude any receipt-level tax. Verify before saving.</Text>
            </View> : null}
            {selected.length > 1 && !editing ? <Text style={{ color: c.brand, marginBottom: 12 }}>{selected.length} products selected · {money(selected.reduce((sum,i) => sum + items[i].price, 0))}. Dates and notes apply to all selected products.</Text> : <Field c={c} label="Product name *" placeholder="e.g. Wireless headphones" value={form.title} onChangeText={v => changeForm('title', v)}/> }
            <Field c={c} label="Store *" placeholder="e.g. Best Buy" value={form.store} onChangeText={v => changeForm('store', v)}/>
            {selected.length > 1 && !editing ? null : <Field c={c} label="Price (USD)" placeholder="0.00" keyboardType="decimal-pad" value={form.price} onChangeText={v => changeForm('price', v)}/> }
            <Field c={c} label="Purchase date" placeholder="YYYY-MM-DD" value={form.purchaseDate} onChangeText={v => changeForm('purchaseDate', v)} hint="Use YYYY-MM-DD, e.g. 2026-11-11."/>
            {dateCalendar('purchaseDate')}
            <Field c={c} label="Store return window (days)" placeholder="30" keyboardType="number-pad" value={form.returnDays} onChangeText={v => {
              setForm(prev => ({
                ...prev, returnDays: v, customDeadline: false,
                returnDeadline: parseDate(prev.purchaseDate) && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 3650 ? addDays(prev.purchaseDate, Number(v)) : prev.returnDeadline,
              }));
            }} hint="Enter the store's actual policy; holidays and exceptions may apply."/>
            <Field c={c} label="Return deadline" placeholder="YYYY-MM-DD" value={form.returnDeadline} onChangeText={v => setForm(prev => ({ ...prev, returnDeadline: v, customDeadline: true }))} hint="Editable. Confirm this date with the retailer."/>
            {dateCalendar('returnDeadline')}
            <Field c={c} label="Warranty expiration (optional)" placeholder="YYYY-MM-DD" value={form.warrantyDeadline} onChangeText={v => changeForm('warrantyDeadline', v)}/>
            {dateCalendar('warrantyDeadline')}
            <Field c={c} label="Notes (optional)" placeholder="Order number, conditions, etc." multiline value={form.notes} onChangeText={v => changeForm('notes', v)}/>
            <View style={{ marginTop: 6 }}>{actionButton(saving ? 'Saving…' : editing ? 'Save changes' : selected.length > 1 ? `Save ${selected.length} purchases` : 'Save purchase', () => { void persist(); }, 'checkmark-circle-outline')}</View>
            <Text style={{ ...subtitle, textAlign: 'center', marginTop: 14, lineHeight: 18 }}>Receipt text is recognized on your device. Check the detected store, total and date before saving. Return windows must be verified with the retailer.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>;
  }

  return <View style={{ flex: 1, backgroundColor: c.bg }}>
    <StatusBar style={dark ? 'light' : 'dark'}/>
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right', 'bottom']}>
      {busy ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={c.brand}/>
        <Text style={{ ...subtitle, marginTop: 13 }}>Opening ReturnRadar…</Text>
      </View> : <>
        <ScrollView key={tab} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: 8, paddingBottom: 95 }}>
          {tab === 'home' ? home() : tab === 'purchases' ? purchasesScreen() : tab === 'deadlines' ? deadlinesScreen() : settingsScreen()}
        </ScrollView>
        {tab !== 'settings' ? <Pressable onPress={openAdd} accessibilityLabel="Add purchase" style={{ position: 'absolute', right: 23, bottom: 90 + insets.bottom, backgroundColor: c.brand, width: 56, height: 56, borderRadius: 19, alignItems: 'center', justifyContent: 'center', shadowColor: '#1829A3', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}>
          <Ionicons name="add" size={32} color="#FFFFFF"/>
        </Pressable> : null}
        <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.border, paddingTop: 10, paddingBottom: 8 }}>
          {TABS.map(t => <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', gap: 5, padding: 5 }}>
            <Ionicons name={tab === t.key ? t.selected : t.icon} size={23} color={tab === t.key ? c.brand : c.secondary}/>
            <Text style={{ fontSize: 10, fontWeight: '800', color: tab === t.key ? c.brand : c.secondary }}>{t.label}</Text>
          </Pressable>)}
        </View>
      </>}
    </SafeAreaView>
    {detailModal()}
    {formModal()}
  </View>;
}
export default function App() { return <SafeAreaProvider><AppContent/></SafeAreaProvider>; }
