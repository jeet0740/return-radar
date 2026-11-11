import * as SQLite from 'expo-sqlite';
import type { Purchase, PurchaseInput } from './types';

let database: Promise<SQLite.SQLiteDatabase> | null = null;

async function db() {
  if (!database) {
    database = (async () => {
      const connection = await SQLite.openDatabaseAsync('returnradar.db');
      await connection.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS purchases (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          store TEXT NOT NULL,
          price REAL NOT NULL,
          purchase_date TEXT NOT NULL,
          return_deadline TEXT NOT NULL,
          warranty_deadline TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT NOT NULL,
          receipt_uri TEXT NOT NULL,
          created_at TEXT NOT NULL,
          notification_ids TEXT NOT NULL DEFAULT '[]'
        );
      `);
      return connection;
    })().catch(error => { database = null; throw error; });
  }
  return database;
}

type Row = {
  id: string; title: string; store: string; price: number; purchase_date: string;
  return_deadline: string; warranty_deadline: string; status: Purchase['status'];
  notes: string; receipt_uri: string; created_at: string; notification_ids: string;
};

function mapRow(row: Row): Purchase {
  let notificationIds: string[] = [];
  try { notificationIds = JSON.parse(row.notification_ids) as string[]; } catch {}
  return {
    id: row.id, title: row.title, store: row.store, price: row.price,
    purchaseDate: row.purchase_date, returnDeadline: row.return_deadline,
    warrantyDeadline: row.warranty_deadline, status: row.status,
    notes: row.notes, receiptUri: row.receipt_uri, createdAt: row.created_at,
    notificationIds,
  };
}

export async function listPurchases(): Promise<Purchase[]> {
  const rows = await (await db()).getAllAsync<Row>('SELECT * FROM purchases ORDER BY created_at DESC');
  return rows.map(mapRow);
}

export async function savePurchase(input: PurchaseInput, previous?: Purchase): Promise<Purchase> {
  const record: Purchase = {
    ...input,
    id: previous?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    notificationIds: previous?.notificationIds ?? [],
  };
  await (await db()).runAsync(
    `INSERT OR REPLACE INTO purchases
     (id, title, store, price, purchase_date, return_deadline, warranty_deadline, status, notes, receipt_uri, created_at, notification_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id, record.title, record.store, record.price, record.purchaseDate,
    record.returnDeadline, record.warrantyDeadline, record.status, record.notes,
    record.receiptUri, record.createdAt, JSON.stringify(record.notificationIds),
  );
  return record;
}

export async function setNotificationIds(id: string, ids: string[]) {
  await (await db()).runAsync('UPDATE purchases SET notification_ids = ? WHERE id = ?', JSON.stringify(ids), id);
}

export async function removePurchase(id: string) {
  await (await db()).runAsync('DELETE FROM purchases WHERE id = ?', id);
}
