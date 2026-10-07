-- Customer thank-you messages (WhatsApp + SMS) sent after a bill is printed.
--
-- The delivery outcome belongs "on the bill", but `bills` is UPDATE-revoked
-- for the application role (002_privileges.sql) and must stay that way, so the
-- outcome lives here, one row per bill, the same way a void does
-- (004_bill_voids.sql).
--
-- The PRIMARY KEY on bill_id is also the duplicate guard. The handler INSERTs
-- the row BEFORE it calls either provider, with ON CONFLICT DO NOTHING; a
-- second Print, a retried request, or two tabs racing each other all find the
-- row already there and send nothing. A row stuck at PENDING therefore means
-- "the process died mid-send" and is deliberately NOT retried automatically:
-- a customer getting the message twice is worse than not getting it at all.

CREATE TABLE IF NOT EXISTS bill_notifications (
  bill_id             text        PRIMARY KEY REFERENCES bills(id),
  kind                text        NOT NULL DEFAULT 'thank_you',
  -- The number actually messaged, normalised to digits with country code
  -- (e.g. 919876543210). The bill keeps whatever the cashier typed.
  phone               text        NOT NULL,
  whatsapp_status     text        NOT NULL DEFAULT 'PENDING'
                        CHECK (whatsapp_status IN ('PENDING','SENT','FAILED','SKIPPED')),
  whatsapp_message_id text,
  whatsapp_error      text,
  sms_status          text        NOT NULL DEFAULT 'PENDING'
                        CHECK (sms_status IN ('PENDING','SENT','FAILED','SKIPPED')),
  sms_message_id      text,
  sms_error           text,
  requested_by_uid    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bill_notifications_created_idx ON bill_notifications (created_at DESC);

-- INSERT to claim, UPDATE to record the outcome, never DELETE: removing the
-- row would re-arm the send for a bill whose customer was already messaged.
GRANT SELECT, INSERT, UPDATE ON bill_notifications TO pos_app;
REVOKE DELETE ON bill_notifications FROM pos_app;

DO $$
BEGIN
  IF has_table_privilege('pos_app', 'bill_notifications', 'DELETE') THEN
    RAISE EXCEPTION 'pos_app must not be able to delete a thank-you delivery record';
  END IF;
  IF NOT has_table_privilege('pos_app', 'bill_notifications', 'INSERT')
     OR NOT has_table_privilege('pos_app', 'bill_notifications', 'UPDATE') THEN
    RAISE EXCEPTION 'pos_app must be able to record thank-you deliveries';
  END IF;
END $$;
