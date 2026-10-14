/** Shapes returned by the POS server. Mirrors the row mappers in
 *  aws/backend/src/handlers/callable/queries.ts — keep the two in step. */

export type Role = "admin" | "manager" | "owner" | "billing" | "kitchen" | "cafe_billing";

export type Kind = "food" | "alcohol" | "cafe";

export interface Category {
  id: string;
  name: string;
  status: string;
  sort_order: number;
  kind: Kind;
  sales_channel: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  /** null means "not stock-tracked" — distinct from 0, which means sold out. */
  stock_qty: number | null;
  description: string | null;
  brand: string | null;
  bottle_size: string | null;
  tax_rate: number;
  status: string;
  kind: Kind;
  image_url: string | null;
}

export interface TableRow {
  id: string;
  table_no: string;
  seats: number;
  status: "available" | "open";
  session_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  opened_at: string | null;
  subtotal: number;
  tax: number;
  grand_total: number;
  item_count: number;
}

export interface SessionLine {
  item_kind: Kind;
  item_id: string | null;
  item_name: string;
  brand: string;
  bottle_size: string;
  price: number;
  qty: number;
  tax_rate: number;
  line_total: number;
}

export interface TableSession {
  id: string;
  table_id: string;
  table_no: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  opened_at: string | null;
  items: SessionLine[];
  subtotal: number;
  tax: number;
  grand_total: number;
}

export interface BillLine {
  item_name: string;
  brand: string;
  bottle_size: string;
  price: number;
  qty: number;
  tax_rate: number;
  line_total: number;
}

export interface Bill {
  id: string;
  bill_no: string;
  type: "FOOD" | "ALCOHOL" | "CAFE";
  source: string | null;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  discount: number;
  tax: number;
  grand_total: number;
  payment_method: string;
  status: string;
  created_at: string | null;
  website_order_no: string | null;
  items: BillLine[];
  /** Set when the bill has been cancelled. The bill still exists and is still
      shown — it simply no longer counts towards takings. See billing.voidBill
      and db/migrations/004_bill_voids.sql. */
  voided?: boolean;
  void_reason?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
}

export interface OrderSummary {
  id: string;
  bill_no: string;
  type: string;
  customer_name: string;
  created_at: string;
  grand_total: number;
  payment_method: string;
  status: string;
  /** Set when the bill has been cancelled. The bill still exists and is still
      shown — it simply no longer counts towards takings. See billing.voidBill
      and db/migrations/004_bill_voids.sql. */
  voided?: boolean;
  void_reason?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
}

export type QrStatus = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

export interface QrOrder {
  id: string;
  order_no: string;
  public_ref: string;
  table_id: string;
  table_label: string;
  customer_name: string;
  note: string | null;
  status: QrStatus;
  kitchen_ticket_id: string | null;
  kitchen_status: string | null;
  subtotal: number;
  tax: number;
  grand_total: number;
  pushed_to_bill: number;
  table_session_id: string | null;
  created_at: string | null;
  items: SessionLine[];
}

export type WebsiteStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "PAYMENT_FAILED";

export interface WebsiteOrder {
  id: string;
  ref: string;
  status: WebsiteStatus;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  fulfillment: { type: string; pickup_at: string | null; notes: string };
  items: Array<{ item_name: string; kind: string; qty: number; unit_price_paise: number; line_total_paise: number }>;
  total_paise: number;
  advance_paise: number;
  balance_paise: number;
  paid_paise: number;
  settled_bill_nos: string[];
  bill_status: "billed" | "unbilled";
  kitchen_ticket_id: string | null;
  kitchen_status: string | null;
  created_at: string | null;
  confirmed_at: string | null;
}

export type TicketStatus = "QUEUED" | "PREPARING" | "READY" | "DONE";

export interface KitchenTicket {
  id: string;
  source: "qr" | "website";
  source_id: string;
  ref: string;
  table_label: string | null;
  customer_name: string;
  items: Array<{ name: string; kind: string; qty: number; note: string }>;
  status: TicketStatus;
  note: string;
  accepted_by: string;
  created_at: string | null;
  ready_at: string | null;
  done_at: string | null;
}

export interface Staff {
  /** The API returns `id` on the way OUT but expects `uid` on the way IN
      (staffAdmin.publicUser vs the handler bodies). Read id, send uid. */
  id: string;
  username: string;
  full_name: string;
  phone: string;
  role: Role;
  status: string;
  created_at?: string | null;
}

export interface AuditEntry {
  id: number | string;
  actor_id: string;
  actor_username: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: unknown;
  created_at: string;
}

export interface DashboardStats {
  food_sales_today: number;
  alcohol_sales_today: number;
  cafe_sales_today: number;
  total_sales_today: number;
  food_bills_today: number;
  alcohol_bills_today: number;
  cafe_bills_today: number;
  total_bills_today: number;
  trend: Array<{ date?: string; day?: string; total?: number; sales?: number }>;
  payment_mix: Array<{ method: string; total: number; count?: number }>;
  top_items: Array<{ name: string; qty: number; total?: number; revenue?: number }>;
  hourly_flow: Array<{ hour: number; total?: number; sales?: number; count?: number }>;
  recent_orders: OrderSummary[];
  menu_summary: Record<string, number>;
}

export interface QrAdminTable {
  id: string;
  table_no: string;
  seats: number;
  status: string;
  qr_token: string;
  open_orders: number;
  new_orders: number;
  menu_url: string;
}
