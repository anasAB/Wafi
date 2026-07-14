ALTER TABLE public.receipt_settings
ADD COLUMN IF NOT EXISTS show_whatsapp_receipt BOOLEAN NOT NULL DEFAULT TRUE;
