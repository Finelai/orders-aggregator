-- NULL marks a legacy order whose paid amount has not yet been recovered.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
