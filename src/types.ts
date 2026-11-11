export type PurchaseStatus = 'active' | 'returned' | 'kept';
export type Purchase = {
  id: string;
  title: string;
  store: string;
  price: number;
  purchaseDate: string;
  returnDeadline: string;
  warrantyDeadline: string;
  status: PurchaseStatus;
  notes: string;
  receiptUri: string;
  createdAt: string;
  notificationIds: string[];
};

export type PurchaseInput = Omit<Purchase, 'id' | 'createdAt' | 'notificationIds'>;
