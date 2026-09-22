/* Shared order types + constants. NO secrets, NO server-only deps — safe
   to import from Client Components. The server-only POS client
   (./pos-order-api) re-exports these. */

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "PAYMENT_FAILED";

export type PaymentStatus = "UNPAID" | "ADVANCE_PAID" | "FAILED" | "REFUNDED";

/** Statuses the confirmation page stops polling on. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PAYMENT_FAILED",
  "CANCELLED",
  "COMPLETED",
];

export type WebsiteOrderItem = {
  id: string;
  name: string;
  unitPricePaise: number;
  qty: number;
  lineTotalPaise: number;
};

export type WebsiteOrder = {
  ref: string; // backend-generated Order ID, e.g. WEB-000123 — permanent
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: WebsiteOrderItem[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  amountPaidPaise: number;
  customer: { name: string; phone: string; email?: string };
  fulfillment: { type: "pickup"; pickupAt: string | null; notes?: string };
  createdAt: string;
  confirmedAt: string | null;
  payment?: {
    provider: string; // "razorpay" | "mock"
    amountPaise: number;
    providerOrderId?: string;
    keyId?: string; // Razorpay public key id — safe for the browser
  };
};

export type CreateOrderInput = {
  items: { id: string; qty: number }[];
  customer: { name: string; phone: string; email?: string };
  fulfillment: { type: "pickup"; pickupAt: string | null; notes?: string };
};
