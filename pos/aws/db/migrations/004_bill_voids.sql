-- Voiding a bill.
--
-- A till has to be able to cancel a bill. The cashier rings up table 7's
-- order against table 4, or bills a walk-in twice, and without a way to undo
-- it the day's takings are permanently wrong and the owner reconciles cash
-- against a number they know is a lie.
--
-- The obvious implementation — UPDATE bills SET status='void' — is not
-- available here and should not be. 002_privileges.sql REVOKEs UPDATE and
-- DELETE on `bills` from the application role precisely so that a settled
-- bill cannot be rewritten by the application, by a bug in it, or by anyone
-- who gets hold of its credentials. That guarantee is worth more than the
-- convenience of a status column.
--
-- So a void is recorded as a NEW FACT in its own table rather than as a
-- change to an old one, which is also how the paper version works: you do not
-- erase the entry, you write the reversal underneath it. The bill row stays
-- byte-for-byte what was handed to the customer, and the void carries who did
-- it, when, and why.
--
-- Reads that mean "money the restaurant actually took" must therefore exclude
-- bills that have a row here. See lib/statsService.ts.

CREATE TABLE IF NOT EXISTS bill_voids (
  bill_id            text        PRIMARY KEY REFERENCES bills(id),
  -- Denormalised so the audit trail is readable on its own, and survives
  -- even if a future migration reshapes `bills`.
  bill_no            text        NOT NULL,
  grand_total        numeric(12,2) NOT NULL,
  date_key           text        NOT NULL,
  reason             text        NOT NULL,
  voided_by_uid      text        NOT NULL,
  voided_by_username text,
  voided_at          timestamptz NOT NULL DEFAULT now()
);

-- "Was this bill voided" runs on every bill list; "what was voided today"
-- runs on the day's reconciliation.
CREATE INDEX IF NOT EXISTS bill_voids_date_key_idx ON bill_voids (date_key);

-- INSERT and SELECT only. A void is as permanent as the bill it reverses:
-- un-voiding by rewriting this row would put the money back without a trace,
-- which is exactly the hole the immutable-bills rule exists to close. A void
-- entered in error is corrected by raising the bill again, not by deleting
-- the record that it was cancelled.
GRANT SELECT, INSERT ON bill_voids TO pos_app;
REVOKE UPDATE, DELETE ON bill_voids FROM pos_app;

DO $$
BEGIN
  IF has_table_privilege('pos_app', 'bill_voids', 'UPDATE')
     OR has_table_privilege('pos_app', 'bill_voids', 'DELETE') THEN
    RAISE EXCEPTION 'pos_app must not be able to alter or remove a recorded void';
  END IF;
  IF NOT has_table_privilege('pos_app', 'bill_voids', 'INSERT') THEN
    RAISE EXCEPTION 'pos_app must be able to record a void';
  END IF;
END $$;
